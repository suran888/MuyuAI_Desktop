# 窗口大小和层级逻辑分析

## 📐 窗口大小相关逻辑

### 1. **初始窗口大小定义** (`windowManager.js`)

#### Header 窗口
```javascript
// 行 801-812
const HEADER_HEIGHT = 47;
const DEFAULT_WINDOW_WIDTH = 353;
```

#### Main 窗口
```javascript
// 行 524-530
width: 524,
height: 393,
maxHeight: 900,
```

#### Listen 窗口
```javascript
// 行 562-564
width: 400,
minWidth: 400,
maxWidth: 900,
maxHeight: 900,
```

#### Ask 窗口
```javascript
// 行 597-602
width: 524,
height: 393,
maxHeight: 393,
minHeight: 393  // 固定高度，不可调整
```

#### Screenshot 窗口
```javascript
// 行 636-641
width: 524,
height: 393,
maxHeight: 393,
minHeight: 393  // 固定高度
```

#### Transcript 窗口
```javascript
// 行 660-665
width: 400,
height: 393,
maxHeight: 900,
minHeight: 300
```

#### Settings 窗口
```javascript
// 行 685
width: 240,
maxHeight: 400
```

#### Shortcut Settings 窗口
```javascript
// 行 720-722
width: 353,
height: 720
```

### 2. **动态窗口大小调整**

#### 2.1 Header 窗口大小调整 (`windowManager.js:157-203`)
```javascript
internalBridge.on('window:resizeHeaderWindow', ({ width, height }) => {
    // 优先处理 main 窗口
    const mainWin = windowPool.get('main');
    if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) {
        const bounds = mainWin.getBounds();
        let newX = bounds.x;
        
        // 保持左边缘不变，向右扩展
        // 如果超出右边界，向左调整
        if (newX + width > workArea.x + workArea.width) {
            const overflow = (newX + width) - (workArea.x + workArea.width);
            newX -= overflow;
            if (newX < workArea.x) {
                newX = workArea.x;
            }
        }
        
        // 使用平滑动画调整大小
        movementManager.animateWindowBounds(mainWin, {
            x: newX,
            y: bounds.y,
            width,
            height
        });
        return;
    }
    
    // 否则调整 header 窗口
    const newHeaderBounds = layoutManager.calculateHeaderResize(header, { width, height });
    // ... 动画调整
});
```

#### 2.2 Header 大小计算 (`windowLayoutManager.js:97-106`)
```javascript
calculateHeaderResize(header, { width, height }) {
    const currentBounds = header.getBounds();
    const centerX = currentBounds.x + currentBounds.width / 2;
    const newX = Math.round(centerX - width / 2);  // 以中心点为基准调整
    
    // 限制在工作区内
    const display = getCurrentDisplay(header);
    const { x: workAreaX, width: workAreaWidth } = display.workArea;
    const clampedX = Math.max(workAreaX, Math.min(workAreaX + workAreaWidth - width, newX));
    
    return { x: clampedX, y: currentBounds.y, width, height };
}
```

#### 2.3 窗口高度调整 (`windowLayoutManager.js:118-129`)
```javascript
calculateWindowHeightAdjustment(senderWindow, targetHeight) {
    const currentBounds = senderWindow.getBounds();
    const minHeight = senderWindow.getMinimumSize()[1];
    const maxHeight = senderWindow.getMaximumSize()[1];
    
    // 限制在最小/最大高度范围内
    let adjustedHeight = Math.max(minHeight, targetHeight);
    if (maxHeight > 0) {
        adjustedHeight = Math.min(maxHeight, adjustedHeight);
    }
    
    return { ...currentBounds, height: adjustedHeight };
}
```

#### 2.4 功能窗口布局计算 (`windowLayoutManager.js:132-250`)

**Listen 窗口大小：**
```javascript
// 行 176-187
if (listenVis) {
    const listenBounds = listen.getBounds();
    // 强制高度匹配 header，最小 640px
    const targetHeight = Math.max(headerBounds.height, 640);
    layout.listen = {
        x: Math.round(alignedX),
        y: Math.round(alignedY),
        width: listenBounds.width,
        height: targetHeight,  // 动态高度
    };
}
```

**Ask 窗口大小：**
```javascript
// 行 190-215
// 如果 main 窗口可见，ask 窗口与 main 窗口对齐
// 否则相对于 header 定位
// 大小保持固定：524x393
```

### 3. **平滑大小调整动画** (`smoothMovementManager.js:107-155`)
```javascript
animateWindowBounds(win, targetBounds, options = {}) {
    const startBounds = win.getBounds();
    const duration = options.duration || this.animationDuration;  // 默认 300ms
    
    // 使用 ease-out-cubic 缓动函数
    const eased = 1 - Math.pow(1 - progress, 3);
    
    // 同时动画位置和大小
    const newBounds = {
        x: Math.round(startBounds.x + (targetBounds.x - startBounds.x) * eased),
        y: Math.round(startBounds.y + (targetBounds.y - startBounds.y) * eased),
        width: Math.round(startBounds.width + ((targetBounds.width ?? startBounds.width) - startBounds.width) * eased),
        height: Math.round(startBounds.height + ((targetBounds.height ?? startBounds.height) - startBounds.height) * eased),
    };
    
    win.setBounds(newBounds);
}
```

---

## 🎯 窗口层级相关逻辑

### 1. **窗口置顶 (Always On Top)**

#### Settings 窗口
```javascript
// windowManager.js:322-354
if (name === 'settings') {
    if (shouldBeVisible) {
        win.show();
        win.moveTop();                    // 移到最前
        win.setAlwaysOnTop(true);         // 置顶
    } else {
        // 延迟 200ms 后取消置顶并隐藏
        settingsHideTimer = setTimeout(() => {
            win.setAlwaysOnTop(false);
            win.hide();
        }, 200);
    }
}
```

#### Shortcut Settings 窗口
```javascript
// windowManager.js:358-381
if (shouldBeVisible) {
    // macOS 特殊处理
    if (process.platform === 'darwin') {
        win.setAlwaysOnTop(true, 'screen-saver');  // 屏幕保护程序级别
    } else {
        win.setAlwaysOnTop(true);
    }
    disableClicks(win);  // 禁用其他窗口的点击
} else {
    if (process.platform === 'darwin') {
        win.setAlwaysOnTop(false, 'screen-saver');
    } else {
        win.setAlwaysOnTop(false);
    }
    restoreClicks();  // 恢复其他窗口的点击
}
```

#### Header 窗口
```javascript
// windowManager.js:810-819
const header = new BrowserWindow({
    // ...
    alwaysOnTop: true,  // 创建时即置顶
    // ...
});
```

### 2. **窗口透明度控制 (视觉层级)**

#### Header 状态切换时的透明度
```javascript
// windowManager.js:1027-1046
if (state === 'main') {
    // 隐藏 header（透明 + 点击穿透）
    header.setOpacity(0);
    header.setIgnoreMouseEvents(true, { forward: true });
} else {
    // 恢复 header（可见 + 可点击）
    header.setOpacity(1);
    header.setIgnoreMouseEvents(false);
}
```

#### 窗口显示/隐藏时的淡入淡出
```javascript
// windowManager.js:412-416, 445-448, 464-467
// Listen/Ask/Screenshot/Transcript 窗口
if (shouldBeVisible) {
    win.setOpacity(0);              // 初始透明
    win.setBounds(targetBounds);
    win.show();
    movementManager.fade(win, { to: 1 });  // 淡入到不透明
} else {
    movementManager.fade(win, { to: 0, onComplete: () => win.hide() });  // 淡出后隐藏
}
```

#### 平滑透明度动画 (`smoothMovementManager.js:81-105`)
```javascript
fade(win, { from, to, duration = 250, onComplete }) {
    const startOpacity = from ?? win.getOpacity();
    const startTime = Date.now();
    
    const step = () => {
        const progress = Math.min(1, (Date.now() - startTime) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);  // ease-out-cubic
        
        win.setOpacity(startOpacity + (to - startOpacity) * eased);
        
        if (progress < 1) {
            setTimeout(step, 8);
        } else {
            win.setOpacity(to);
            if (onComplete) onComplete();
        }
    };
    step();
}
```

### 3. **鼠标事件穿透 (交互层级)**

#### 禁用其他窗口点击
```javascript
// windowManager.js:308-320
const disableClicks = (selectedWindow) => {
    for (const [name, win] of windowPool) {
        if (win !== selectedWindow && !win.isDestroyed()) {
            win.setIgnoreMouseEvents(true, { forward: true });  // 穿透鼠标事件
        }
    }
};

const restoreClicks = () => {
    for (const [, win] of windowPool) {
        if (!win.isDestroyed()) win.setIgnoreMouseEvents(false);
    }
};
```

#### Header 透明时的点击穿透
```javascript
// windowManager.js:1029-1030
header.setOpacity(0);
header.setIgnoreMouseEvents(true, { forward: true });  // 允许点击穿透到下层窗口
```

### 4. **窗口父子关系 (逻辑层级)**

#### 子窗口创建
```javascript
// windowManager.js:503-504
const commonChildOptions = {
    parent: header,  // 所有功能窗口都是 header 的子窗口
    // ...
};
```

**例外：**
- Settings 窗口：`parent: undefined` (行 685)
- Shortcut Settings 窗口：`parent: undefined` (行 724)
- Main 窗口（独立模式）：`parent: undefined` (行 946)

### 5. **窗口显示顺序控制**

#### moveTop() - 移到最前
```javascript
// windowManager.js:334
win.moveTop();  // Settings 窗口显示时移到最前
```

#### 窗口可见性管理
```javascript
// windowManager.js:248-281
function changeAllWindowsVisibility(windowPool, targetVisibility) {
    if (header.isVisible()) {
        // 记录当前可见的窗口
        lastVisibleWindows.clear();
        windowPool.forEach((win, name) => {
            if (win && !win.isDestroyed() && win.isVisible()) {
                lastVisibleWindows.add(name);
            }
        });
        
        // 隐藏所有窗口（除了 header）
        lastVisibleWindows.forEach(name => {
            if (name === 'header') return;
            const win = windowPool.get(name);
            if (win && !win.isDestroyed()) win.hide();
        });
        header.hide();
    } else {
        // 恢复之前可见的窗口
        lastVisibleWindows.forEach(name => {
            const win = windowPool.get(name);
            if (win && !win.isDestroyed()) win.show();
        });
    }
}
```

---

## 🔄 窗口大小和层级的关系

### 1. **大小调整触发布局更新**
```javascript
// windowManager.js:918
header.on('resize', () => updateChildWindowLayouts(false));
```

### 2. **布局计算考虑层级**
- Header 窗口作为参考点
- Main 窗口优先（如果可见）
- 其他窗口相对于 Header/Main 定位

### 3. **动画同步**
- 大小调整和位置调整同时动画
- 透明度变化独立动画
- 使用相同的缓动函数（ease-out-cubic）

---

## 📊 总结

### 窗口大小特点：
1. **固定大小窗口**：Ask (524x393)、Screenshot (524x393)
2. **可变高度窗口**：Listen (400宽，最小640高，最大900高)
3. **动态调整窗口**：Main、Header（通过 IPC 消息调整）
4. **限制范围**：所有窗口大小调整都限制在工作区内

### 窗口层级特点：
1. **置顶窗口**：Header（始终）、Settings（显示时）、Shortcut Settings（显示时）
2. **透明度控制**：用于淡入淡出效果和 Header 隐藏
3. **点击穿透**：用于模态窗口和 Header 隐藏状态
4. **父子关系**：大部分功能窗口是 Header 的子窗口，但 Settings 和 Shortcut Settings 是独立窗口

### 动画特点：
- **持续时间**：位置/大小调整 300ms，透明度 250ms
- **缓动函数**：ease-out-cubic
- **更新频率**：每 8ms 更新一次（约 120fps）


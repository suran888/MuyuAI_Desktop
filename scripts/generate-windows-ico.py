import os
import sys


def main() -> int:
    try:
        from PIL import Image  # type: ignore
    except Exception:
        print("❌ 缺少 Pillow 依赖。请先安装：pip install pillow")
        return 1

    repo_root = os.path.join(os.path.dirname(__file__), "..")
    assets_dir = os.path.join(repo_root, "src", "ui", "assets")

    src_png = os.path.join(assets_dir, "logo.png")
    dst_ico = os.path.join(assets_dir, "logo.ico")

    if not os.path.exists(src_png):
        print(f"❌ 找不到源图标：{src_png}")
        return 1

    img = Image.open(src_png).convert("RGBA")

    # 与原脚本保持一致：16/32/48/64/128/256
    sizes = [(s, s) for s in [16, 32, 48, 64, 128, 256]]

    # 生成多尺寸 ico（包含多个目录条目，Windows 任务栏/快捷方式将使用对应尺寸）
    img.save(dst_ico, format="ICO", sizes=sizes)

    print(f"✅ 已生成：{dst_ico}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


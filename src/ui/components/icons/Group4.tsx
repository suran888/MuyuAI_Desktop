import React from "react";
import svgPaths from "../../imports/svg-apdjujtony";

interface Group4Props {
  width?: number;
  height?: number;
}

export function Group4({ width = 524, height = 393 }: Group4Props) {
  return (
    <div
      style={{
        width,
        height,
        background: '#030010BF',
        position: 'relative',
        zIndex: 0
      }}
      className="group4-container rounded-[19px]"
    >
      <style>{`
        .group4-container::before {
          content: '';
          position: absolute;
          right: 62px;
          top: 0;
          width: 1px;
          height: 100%;
          background-color: #FFFFFF1A;
        }
      `}</style>
    </div>
  );
}


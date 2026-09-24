import type { SVGProps } from "react";

/**
 * Subconjunto de Iconoir 7.11.1 (https://github.com/iconoir-icons/iconoir).
 * Copyright (c) 2021 Luca Burgio. Licenciado sob MIT:
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions: the above copyright
 * notice and this permission notice shall be included in all copies or
 * substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
 * WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
 */

export type IconName =
  | "flash"
  | "keyboard"
  | "fork"
  | "arrows"
  | "jump"
  | "sound"
  | "music"
  | "variable"
  | "calculator"
  | "eye-off"
  | "spawn"
  | "film"
  | "camera"
  | "grid"
  | "clock"
  | "layers"
  | "chip"
  | "undo"
  | "redo"
  | "organize"
  | "link"
  | "group"
  | "bug"
  | "check-circle"
  | "drag"
  | "folder"
  | "gamepad"
  | "info-circle"
  | "magic-wand"
  | "maximize"
  | "menu"
  | "network"
  | "open-new-window"
  | "palette"
  | "pin"
  | "pin-slash"
  | "play"
  | "refresh"
  | "search"
  | "settings"
  | "sidebar-collapse"
  | "sidebar-expand"
  | "square"
  | "terminal"
  | "warning-triangle";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  name: IconName;
  size?: number;
}

function IconPaths({ name }: { name: IconName }) {
  switch (name) {
    // Icones abaixo (ate "group") desenhados localmente no mesmo estilo de traco; nao sao Iconoir.
    case "flash":
      return <path d="M13 3L5 13.5H11.5L10.5 21L19 10H12.5L13 3Z"/>;
    case "keyboard":
      return <><path d="M3 6.6C3 6.26863 3.26863 6 3.6 6H20.4C20.7314 6 21 6.26863 21 6.6V17.4C21 17.7314 20.7314 18 20.4 18H3.6C3.26863 18 3 17.7314 3 17.4V6.6Z"/><path d="M7 10H7.01M11 10H11.01M15 10H15.01M17 10H17.01M8 14H16"/></>;
    case "fork":
      return <><path d="M12 3V9"/><path d="M12 9L6 15V21"/><path d="M12 9L18 15V21"/></>;
    case "arrows":
      return <><path d="M3 12H21"/><path d="M17 8L21 12L17 16"/><path d="M7 8L3 12L7 16"/></>;
    case "jump":
      return <><path d="M12 21V5"/><path d="M6 11L12 5L18 11"/><path d="M5 21H19"/></>;
    case "sound":
      return <><path d="M4 9.6V14.4C4 14.7314 4.26863 15 4.6 15H8L13 19V5L8 9H4.6C4.26863 9 4 9.26863 4 9.6Z"/><path d="M16.5 8.5C17.5 9.5 18 10.7 18 12C18 13.3 17.5 14.5 16.5 15.5"/></>;
    case "music":
      return <><path d="M9 18V5L20 3V16"/><path d="M6.5 20.5C7.88071 20.5 9 19.3807 9 18C9 16.6193 7.88071 15.5 6.5 15.5C5.11929 15.5 4 16.6193 4 18C4 19.3807 5.11929 20.5 6.5 20.5Z"/><path d="M17.5 18.5C18.8807 18.5 20 17.3807 20 16C20 14.6193 18.8807 13.5 17.5 13.5C16.1193 13.5 15 14.6193 15 16C15 17.3807 16.1193 18.5 17.5 18.5Z"/></>;
    case "variable":
      return <><path d="M8 4C6 4 6 6 6 8V10C6 11 5 12 4 12C5 12 6 13 6 14V16C6 18 6 20 8 20"/><path d="M16 4C18 4 18 6 18 8V10C18 11 19 12 20 12C19 12 18 13 18 14V16C18 18 18 20 16 20"/><path d="M10 9L14 15M14 9L10 15"/></>;
    case "calculator":
      return <><path d="M5 3.6C5 3.26863 5.26863 3 5.6 3H18.4C18.7314 3 19 3.26863 19 3.6V20.4C19 20.7314 18.7314 21 18.4 21H5.6C5.26863 21 5 20.7314 5 20.4V3.6Z"/><path d="M8 7H16M8 12H8.01M12 12H12.01M16 12H16.01M8 16H8.01M12 16H12.01M16 16H16.01"/></>;
    case "eye-off":
      return <><path d="M3 3L21 21"/><path d="M10.5 6.2C11 6.1 11.5 6 12 6C16.5 6 20 12 20 12C19.4 13 18.7 13.9 17.9 14.7M14.1 14.1C13.6 14.6 12.8 15 12 15C10.3 15 9 13.7 9 12C9 11.2 9.3 10.4 9.9 9.9M6.3 7.8C4.9 9 4 10.6 4 12C4 12 7.5 18 12 18C13.4 18 14.7 17.5 15.8 16.8"/></>;
    case "spawn":
      return <><path d="M12 5V19M5 12H19"/><path d="M3.6 3H20.4C20.7314 3 21 3.26863 21 3.6V20.4C21 20.7314 20.7314 21 20.4 21H3.6C3.26863 21 3 20.7314 3 20.4V3.6C3 3.26863 3.26863 3 3.6 3Z"/></>;
    case "film":
      return <><path d="M3 4.6C3 4.26863 3.26863 4 3.6 4H20.4C20.7314 4 21 4.26863 21 4.6V19.4C21 19.7314 20.7314 20 20.4 20H3.6C3.26863 20 3 19.7314 3 19.4V4.6Z"/><path d="M7 4V20M17 4V20M3 8H7M3 12H7M3 16H7M17 8H21M17 12H21M17 16H21"/></>;
    case "camera":
      return <><path d="M2 8.6C2 8.26863 2.26863 8 2.6 8H6L8 5H16L18 8H21.4C21.7314 8 22 8.26863 22 8.6V19.4C22 19.7314 21.7314 20 21.4 20H2.6C2.26863 20 2 19.7314 2 19.4V8.6Z"/><path d="M12 17C14.2091 17 16 15.2091 16 13C16 10.7909 14.2091 9 12 9C9.79086 9 8 10.7909 8 13C8 15.2091 9.79086 17 12 17Z"/></>;
    case "grid":
      return <><path d="M3 3H21V21H3V3Z"/><path d="M3 9H21M3 15H21M9 3V21M15 3V21"/></>;
    case "clock":
      return <><path d="M12 6V12H18"/><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"/></>;
    case "layers":
      return <><path d="M12 3L21 8L12 13L3 8L12 3Z"/><path d="M3 12L12 17L21 12"/><path d="M3 16L12 21L21 16"/></>;
    case "chip":
      return <><path d="M7 7H17V17H7V7Z"/><path d="M10 3V7M14 3V7M10 17V21M14 17V21M3 10H7M3 14H7M17 10H21M17 14H21"/></>;
    case "undo":
      return <><path d="M4.5 8H15C17.7614 8 20 10.2386 20 13C20 15.7614 17.7614 18 15 18H8"/><path d="M8.5 4L4.5 8L8.5 12"/></>;
    case "redo":
      return <><path d="M19.5 8H9C6.23858 8 4 10.2386 4 13C4 15.7614 6.23858 18 9 18H16"/><path d="M15.5 4L19.5 8L15.5 12"/></>;
    case "organize":
      return <><path d="M3 4H9V9H3V4Z"/><path d="M15 4H21V9H15V4Z"/><path d="M15 15H21V20H15V15Z"/><path d="M9 6.5H15M18 9V15"/></>;
    case "link":
      return <><path d="M14 11.9976C14 9.5059 11.683 7 8.85714 7C8.52241 7 7.41904 7.00001 7.14286 7.00001C4.30254 7.00001 2 9.23752 2 11.9976C2 14.376 3.70973 16.3664 6 16.8714C6.36756 16.9525 6.75006 16.9952 7.14286 16.9952"/><path d="M10 11.9976C10 14.4893 12.317 16.9952 15.1429 16.9952C15.4776 16.9952 16.581 16.9952 16.8571 16.9952C19.6975 16.9952 22 14.7577 22 11.9976C22 9.6192 20.2903 7.62884 18 7.12383C17.6324 7.04278 17.2499 6.99999 16.8571 6.99999"/></>;
    case "group":
      return <><path d="M3 5.6C3 5.26863 3.26863 5 3.6 5H20.4C20.7314 5 21 5.26863 21 5.6V18.4C21 18.7314 20.7314 19 20.4 19H3.6C3.26863 19 3 18.7314 3 18.4V5.6Z" strokeDasharray="3 2"/><path d="M7 9H11V13H7V9Z"/><path d="M13 11H17V15H13V11Z"/></>;
    case "menu":
      return <><path d="M3 5H21"/><path d="M3 12H21"/><path d="M3 19H21"/></>;
    case "play":
      return <path d="M6.90588 4.53682C6.50592 4.2998 6 4.58808 6 5.05299V18.947C6 19.4119 6.50592 19.7002 6.90588 19.4632L18.629 12.5162C19.0211 12.2838 19.0211 11.7162 18.629 11.4838L6.90588 4.53682Z"/>;
    case "square":
      return <path d="M21 3.6V20.4C21 20.7314 20.7314 21 20.4 21H3.6C3.26863 21 3 20.7314 3 20.4V3.6C3 3.26863 3.26863 3 3.6 3H20.4C20.7314 3 21 3.26863 21 3.6Z"/>;
    case "terminal":
      return <><path d="M13 17H20"/><path d="M5 7L10 12L5 17"/></>;
    case "gamepad":
      return <><path d="M17.5 17.5C20 21 23.9486 18.4151 23 15C21.5753 9.87113 20.8001 7.01556 20.3969 5.50793C20.1597 4.62136 19.3562 4 18.4384 4L5.56155 4C4.64382 4 3.844 4.62481 3.62085 5.515C2.7815 8.86349 2.0326 11.8016 1.14415 15C0.195501 18.4151 4.14415 21 6.64415 17.5"/><path d="M18 8.5L18.0111 8.51M16.49 7L16.5011 7.01M16.49 10L16.5011 10.01M15 8.5L15.0111 8.51"/><path d="M7 7V10M5.5 8.5H8.5"/><path d="M8 16C9.10457 16 10 15.1046 10 14C10 12.8954 9.10457 12 8 12C6.89543 12 6 12.8954 6 14C6 15.1046 6.89543 16 8 16Z"/><path d="M16 16C17.1046 16 18 15.1046 18 14C18 12.8954 17.1046 12 16 12C14.8954 12 14 12.8954 14 14C14 15.1046 14.8954 16 16 16Z"/></>;
    case "folder":
      return <path d="M2 11V4.6C2 4.26863 2.26863 4 2.6 4H8.77805C8.92127 4 9.05977 4.05124 9.16852 4.14445L12.3315 6.85555C12.4402 6.94876 12.5787 7 12.722 7H21.4C21.7314 7 22 7.26863 22 7.6V19.4C22 19.7314 21.7314 20 21.4 20H2.6C2.26863 20 2 19.7314 2 19.4V11ZM2 11H22"/>;
    case "network":
      return <><rect x="3" y="2" width="7" height="5" rx="0.6"/><rect x="8.5" y="17" width="7" height="5" rx="0.6"/><rect x="14" y="2" width="7" height="5" rx="0.6"/><path d="M6.5 7V10.5C6.5 11.6046 7.39543 12.5 8.5 12.5H15.5C16.6046 12.5 17.5 11.6046 17.5 10.5V7M12 12.5V17"/></>;
    case "palette":
      return <><path d="M20.5096 9.54C20.4243 9.77932 20.2918 9.99909 20.12 10.1863C19.9483 10.3735 19.7407 10.5244 19.5096 10.63C17.013 11.75 15.378 14.228 15.3696 17C15.3711 17.4701 15.418 17.9389 15.5096 18.4C15.757 19.54 15.061 20.666 13.9896 20.85C8.775 21.83 3.203 17.79 3.36959 11.72C3.4472 9.47279 4.3586 7.33495 5.92622 5.72296C7.49385 4.11097 9.60542 3.14028 11.8496 3H12.3596C15.773 3.001 18.892 4.927 20.4196 8C20.6488 8.47498 20.6812 9.02129 20.5096 9.52V9.54Z"/><path d="M8 16.01L8.01 15.9989M6 12.01L6.01 11.9989M8 8.01L8.01 7.99889M12 6.01L12.01 5.99889M16 8.01L16.01 7.99889"/></>;
    case "magic-wand":
      return <><path d="M3 21L13 11M18 6L15.5 8.5"/><path d="M9.5 2L10.4453 4.55468L13 5.5L10.4453 6.44532L9.5 9L8.55468 6.44532L6 5.5L8.55468 4.55468L9.5 2Z"/><path d="M19 10L19.5402 11.4598L21 12L19.5402 12.5402L19 14L18.4598 12.5402L17 12L18.4598 11.4598L19 10Z"/></>;
    case "bug":
      return <><path d="M12 21C8.13401 21 5 16.9706 5 12C5 7.02944 8.13401 3 12 3C15.866 3 19 7.02944 19 12C19 16.9706 15.866 21 12 21Z"/><path d="M18 17.5L20 19.5M19 9.5L21 8.5M5 9.5L3 8.5M5 14H2M22 14H19M6 17.5L4 19.5"/><path d="M18 8C18 8 15 9 12 9M6 8C6 8 9 9 12 9M12 9V21"/></>;
    case "settings":
      return <><path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"/><path d="M19.6224 10.3954L18.5247 7.7448L20 6L18 4L16.2647 5.48295L13.5578 4.36974L12.9353 2H10.981L10.3491 4.40113L7.70441 5.51596L6 4L4 6L5.45337 7.78885L4.3725 10.4463L2 11V13L4.40111 13.6555L5.51575 16.2997L4 18L6 20L7.79116 18.5403L10.397 19.6123L11 22H13L13.6045 19.6132L16.2551 18.5155C16.6969 18.8313 18 20 18 20L20 18L18.5159 16.2494L19.6139 13.598L22 12.9772V11L19.6224 10.3954Z"/></>;
    case "search":
      return <><path d="M17 17L21 21"/><path d="M3 11C3 15.4183 6.58172 19 11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11Z"/></>;
    case "warning-triangle":
      return <><path d="M20.0429 21H3.95705C2.41902 21 1.45658 19.3364 2.22324 18.0031L10.2662 4.01533C11.0352 2.67792 12.9648 2.67791 13.7338 4.01532L21.7768 18.0031C22.5434 19.3364 21.581 21 20.0429 21Z"/><path d="M12 9V13M12 17.01L12.01 16.9989"/></>;
    case "info-circle":
      return <><path d="M12 11.5V16.5M12 7.51L12.01 7.49889"/><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"/></>;
    case "open-new-window":
      return <><path d="M21 3H15M21 3L12 12M21 3V9"/><path d="M21 13V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H11"/></>;
    case "pin":
      return <><path d="M9.5 14.5L3 21"/><path d="M5.00007 9.48528L14.1925 18.6777L15.8895 16.9806L15.4974 13.1944L21.0065 8.5211L15.1568 2.67141L10.4834 8.18034L6.69713 7.78823L5.00007 9.48528Z"/></>;
    case "pin-slash":
      return <><path d="M9.5 14.5L3 21"/><path d="M7.67602 7.8896L6.69713 7.78823L5.00007 9.48528L14.1925 18.6777L15.8895 16.9806L15.7879 16M11.4847 7L15.1568 2.67141L21.0065 8.5211L16.6991 12.175"/><path d="M3 3L21 21"/></>;
    case "maximize":
      return <><path d="M7 4H4V7M17 4H20V7M7 20H4V17M17 20H20V17"/></>;
    case "sidebar-collapse":
      return <><path d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H19C20.1046 3 21 3.89543 21 5V19C21 20.1046 20.1046 21 19 21Z"/><path d="M7.25 10L5.5 12L7.25 14M9.5 21V3"/></>;
    case "sidebar-expand":
      return <><path d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H19C20.1046 3 21 3.89543 21 5V19C21 20.1046 20.1046 21 19 21Z"/><path d="M9.5 21V3M5.5 10L7.25 12L5.5 14"/></>;
    case "refresh":
      return <><path d="M21.1679 8C19.6247 4.46819 16.1006 2 11.9999 2C6.81459 2 2.55104 5.94668 2.04932 11"/><path d="M17 8H21.4C21.7314 8 22 7.73137 22 7.4V3"/><path d="M2.88146 16C4.42458 19.5318 7.94874 22 12.0494 22C17.2347 22 21.4983 18.0533 22 13"/><path d="M7.04932 16H2.64932C2.31795 16 2.04932 16.2686 2.04932 16.6V21"/></>;
    case "check-circle":
      return <><path d="M7 12.5L10 15.5L17 8.5"/><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"/></>;
    case "drag":
      return <><path d="M12 12L4 4M4 4V8M4 4H8"/><path d="M12 12L20 4M20 4V8M20 4H16"/><path d="M12 12L4 20M4 20V16M4 20H8"/><path d="M12 12L20 20M20 20V16M20 20H16"/></>;
  }
}

export default function Icon({ name, size = 18, className = "", ...props }: IconProps) {
  return (
    <svg
      aria-hidden={props["aria-label"] ? undefined : true}
      className={`shrink-0 ${className}`}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <IconPaths name={name} />
    </svg>
  );
}

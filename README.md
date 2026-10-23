# Markerloom 🖋️

> **Smooth Handwriting & Annotation Engine** for high-performance interactive whiteboards and educational canvas workflows.

[![Status: Ongoing Development](https://img.shields.io/badge/Status-Ongoing%20Development-orange?style=for-the-badge&logo=git)](https://github.com/srkaran756/Markerloom)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue?style=for-the-badge)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16.4-black?style=for-the-badge&logo=next.dot.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-green?style=for-the-badge&logo=vitest)](https://vitest.dev/)

---

### 🚧 Project Status: Ongoing Development
Markerloom is actively under development. Core whiteboard and freehand stroke drawing engines are operational, with performance optimizations, real-time collaboration, and expanded toolsets underway.

---

## ✨ Features

- **⚡ Dual-Canvas Architecture**
  - **Active Canvas**: Low-latency rendering pipeline for real-time pointer tracking and sub-millisecond stroke feedback.
  - **Static Canvas**: High-performance persistence layer with spatial grid indexing for massive stroke counts without frame drops.
- **✍️ High-Fidelity Stroke Smoothing**
  - Pressure-sensitive, dynamic stroke generation powered by `perfect-freehand`.
  - Velocity-weighted easing and variable taper for natural handwriting feel.
- **🔍 Infinite Canvas & Camera Engine**
  - Smooth pan and zoom (middle-click drag, two-finger gesture, Space + drag).
  - Figma-style zoom badge with vertical scrub zooming and zoom presets (`Zoom to 100%`, `Zoom to Fit`, `Zoom In/Out`).
- **🛠️ Creative & Educational Tools**
  - **Pen**: Dynamic handwriting brush with customizable thickness and an educational palette.
  - **Highlighter**: Semi-transparent, layered highlighting with natural ink blending.
  - **Stroke Eraser**: Spatial collision-based instant stroke erasure.
  - **Hand Tool**: Intuitive canvas exploration.
- **⏪ Deep Undo / Redo History**
  - Immutable stroke history with full keyboard shortcut support (`Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`).
- **📐 Grid System & Spatial Partitioning**
  - Background point grid with dynamic zoom-scaled alignment.
  - Spatial bounding-box hashing for instant hit detection and viewport culling.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **UI & State**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Stroke Engine**: [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand)
- **Testing**: [Vitest](https://vitest.dev/) & [Testing Library](https://testing-library.com/)

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ (Node 20+ recommended)
- npm, pnpm, or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/srkaran756/Markerloom.git
cd Markerloom

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to start drawing.

### Running Tests

```bash
npm run test
```

---

## 🗺️ Roadmap (Ongoing Development)

- [x] Dual-canvas rendering engine
- [x] Pressure & velocity smoothing
- [x] Spatial bounding box index
- [x] Infinite pan & zoom with scrub controls
- [x] Stroke-based eraser
- [ ] Export to PNG / SVG / PDF
- [ ] Shape recognition (rectangles, circles, lines, arrows)
- [ ] Text annotation tool
- [ ] Local persistence (IndexedDB / LocalStorage)
- [ ] Real-time multi-user collaboration (WebSockets / WebRTC)

---

## 📄 License

This project is licensed under the [ISC License](LICENSE).

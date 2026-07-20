import { ImageResponse } from 'next/og';

export const alt = 'Assurly — Pre-deploy Ship Gate for AI-built SaaS';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// The gate is drawn as a canvas-coloured bar over the "A" (no mask — Satori doesn't
// support them), which reads as a clean slot against the solid background.
function Mark(): React.ReactElement {
  return (
    <svg width="132" height="132" viewBox="0 0 24 24">
      <path
        d="M7 17.8 L12 5.6 L17 17.8"
        fill="none"
        stroke="#13D492"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="5.6" y="12.35" width="12.8" height="1.7" rx="0.4" fill="#0A0A0B" />
    </svg>
  );
}

export default function OpenGraphImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        backgroundColor: '#0A0A0B',
        padding: '80px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginBottom: 40 }}>
        <Mark />
        <div style={{ display: 'flex', fontSize: 76, fontWeight: 800 }}>
          <span style={{ color: '#FAFAFA' }}>Ass</span>
          <span style={{ color: '#13D492' }}>url</span>
          <span style={{ color: '#FAFAFA' }}>y</span>
        </div>
      </div>
      <div style={{ fontSize: 40, fontWeight: 700, color: '#FAFAFA', marginBottom: 18 }}>
        Pre-deploy Ship Gate for AI-built SaaS
      </div>
      <div style={{ fontSize: 30, color: '#9BA3AF', maxWidth: 900, lineHeight: 1.35 }}>
        Scan your URL, get a Ship Score, fix blockers, and monitor every deploy — before you ship.
      </div>
    </div>,
    { ...size },
  );
}

import { ImageResponse } from 'next/og';

export const alt = 'Assurly — Pre-deploy Ship Gate for AI-built SaaS';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        backgroundColor: '#0f172a',
        padding: '80px',
      }}
    >
      <div style={{ fontSize: 56, fontWeight: 700, color: '#f8fafc', marginBottom: 24 }}>
        Assurly
      </div>
      <div style={{ fontSize: 32, color: '#cbd5e1', maxWidth: 900, lineHeight: 1.35 }}>
        Pre-deploy Ship Gate — URL scan, fixes, and monitoring before you ship.
      </div>
    </div>,
    { ...size },
  );
}

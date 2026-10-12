import type { BackgroundValues } from './backgroundGeometry';
export type BackgroundTemplateId = 'white' | 'transparent' | 'warm' | 'frame' | 'doubleFrame' | 'watermark';
export const backgroundTemplates: { id: BackgroundTemplateId; name: string; values: BackgroundValues }[] = [
  { id: 'white', name: '纯白', values: { fill: '#FFFFFFFF', frame: null, watermark: null } },
  { id: 'transparent', name: '透明', values: { fill: '#FFFFFF00', frame: null, watermark: null } },
  { id: 'warm', name: '暖色纸', values: { fill: '#FFF7E8FF', frame: null, watermark: null } },
  { id: 'frame', name: '单边框', values: { fill: '#FFFFFFFF', frame: { kind: 'single', color: '#000000FF', width: 4, insetRatio: .04, gap: 8 }, watermark: null } },
  { id: 'doubleFrame', name: '双边框', values: { fill: '#FFFFFFFF', frame: { kind: 'double', color: '#000000FF', width: 4, insetRatio: .04, gap: 8 }, watermark: null } },
  { id: 'watermark', name: '水印纸', values: { fill: '#FFFFFFFF', frame: null, watermark: { content: 'Comia', color: '#00000024', fontSize: 64, angleDeg: -30, repeat: true, spacingX: 360, spacingY: 220 } } },
];

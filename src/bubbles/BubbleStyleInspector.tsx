import type { BubbleLayer } from '../domain/types';
import { pushNotice } from '../state/sessionStore';
import { setBubbleStyle } from './commands';
import {StrokeBandFields} from './StrokeBandFields';
import {useStore} from 'zustand';
import {mangaEditStore} from './mangaEditController';
import { RgbaColorField } from './RgbaColorField';

export function BubbleStyleInspector({ bubble,bandsOnly=false }: { bubble: BubbleLayer;bandsOnly?:boolean }) {
  const active=useStore(mangaEditStore,s=>s.active?.id===bubble.id?s.active:null),source=active?.preview.layers[bubble.id],b=source?.type==='bubble'?source:bubble;
  const update = (patch: Parameters<typeof setBubbleStyle>[1]) => { const r = setBubbleStyle(b.id, patch); if (!r.ok) pushNotice('error', r.problems[0].message); };
  return <>{!bandsOnly&&<><RgbaColorField label="气泡填充色" value={b.style.fill} apply={fill => update({ fill })} /><RgbaColorField label="气泡边框色" value={b.style.borderColor} apply={borderColor => update({ borderColor })} /></>}<StrokeBandFields style={b.style} update={update}/></>;
}

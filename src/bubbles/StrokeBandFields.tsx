import type {BubbleStyle,BubbleStrokeBand} from '../domain/types';
import {MangaNumber} from './MangaFields';
import {RgbaColorField} from './RgbaColorField';
export function StrokeBandFields({style,update,prefix='气泡'}:{style:BubbleStyle;update:(style:Partial<BubbleStyle>)=>void;prefix?:string}){
 return <>{(['innerStroke','outerStroke'] as const).map(field=>{const band=style[field]??{enabled:false,width:0,color:style.borderColor},label=prefix+(field==='innerStroke'?'内描边':'外描边'),change=(patch:Partial<BubbleStrokeBand>)=>update({[field]:{...band,...patch}});return <section className="manga-inspector" key={field}><label><input type="checkbox" aria-label={`启用${label}`} checked={band.enabled} onChange={e=>change({enabled:e.target.checked})}/>{label}</label><MangaNumber label={`${label}宽度`} value={band.width} min={0} max={256} step={.25} apply={n=>{change({width:n});return{ok:true,value:undefined};}}/><RgbaColorField label={label} value={band.color} apply={color=>change({color})}/></section>;})}</>;
}

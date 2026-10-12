import {beginImageTrim} from '../images/trimController';
import type {Id} from '../domain/types';
import type {ToolMode} from './types';
export const beginImageCropTarget=(id:Id)=>beginImageTrim(id);
export function effectiveDisplayTool(mode:ToolMode,line:boolean,mask:boolean,crop:boolean,trim=false):ToolMode{return trim?'image-crop':mask?'image-mask':crop?'crop':line?'panel-cut':mode;}

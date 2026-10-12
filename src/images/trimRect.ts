import type {Point,Rect} from '../domain/types';
/** Opposite handle remains fixed; midpoint handles preserve their other axis. */
export function resizeTrimRect(rect:Rect,index:number,p:Point,ratio=false):Rect{
 const west=[0,6,7].includes(index),east=[2,3,4].includes(index),north=[0,1,2].includes(index),south=[4,5,6].includes(index);
 let x0=west?p.x:rect.x,x1=east?p.x:rect.x+rect.width,y0=north?p.y:rect.y,y1=south?p.y:rect.y+rect.height;
 let width=Math.abs(x1-x0),height=Math.abs(y1-y0);
 if(ratio){const corner=(west||east)&&(north||south),scale=corner?Math.min(width/rect.width,height/rect.height):(west||east)?width/rect.width:height/rect.height;width=rect.width*scale;height=rect.height*scale;
  if(west)x0=x1-Math.sign(x1-x0)*width;else if(east)x1=x0+Math.sign(x1-x0)*width;else{x0=rect.x+(rect.width-width)/2;x1=x0+width;}
  if(north)y0=y1-Math.sign(y1-y0)*height;else if(south)y1=y0+Math.sign(y1-y0)*height;else{y0=rect.y+(rect.height-height)/2;y1=y0+height;}
 }
 return{x:Math.min(x0,x1),y:Math.min(y0,y1),width,height};
}

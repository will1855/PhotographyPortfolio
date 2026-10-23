// The Cat reference's smooth implicit union, reduced to a small horizontal
// SVG contour. No blur/threshold filters or full-page canvas are involved.
export function liquidSurface(circles, energy=0) {
  circles=circles.filter((a,i)=>!circles.some((b,j)=>j!==i&&Math.hypot(a.x-b.x,a.y-b.y)+a.r<=b.r&&(a.r<b.r||j<i)));
  const field=(x,y)=>{
    let value=1e6;
    for(const c of circles){const next=Math.hypot(x-c.x,y-c.y)-c.r,k=7;
      const h=Math.max(k-Math.abs(value-next),0)/k;
      value=Math.min(value,next)-h*h*k*.25;
    }
    return value;
  };
  const left=Math.min(...circles.map(c=>c.x-c.r))-8,right=Math.max(...circles.map(c=>c.x+c.r))+8;
  const middle=circles.reduce((sum,c)=>sum+c.y,0)/circles.length;
  const edge=(a,b)=>{for(let k=0;k<10;k++){const m=(a+b)/2;if((field(a,middle)<=0)===(field(m,middle)<=0))a=m;else b=m}return(a+b)/2};
  let top=[],bottom=[],d='',previous=left;
  const flush=()=>{if(top.length){const points=[...top,...bottom.reverse()];const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2].map(v=>v.toFixed(2)).join(',');
    d+='M'+mid(points.at(-1),points[0]);
    for(let i=0;i<points.length;i++)d+='Q'+points[i].map(v=>v.toFixed(2)).join(',')+' '+mid(points[i],points[(i+1)%points.length]);
    d+='Z';top=[];bottom=[]}};
  for(let x=left;x<=right+1.5;x+=1.5){
    if(field(x,middle)<=0){
      if(!top.length){const e=edge(previous,x);top.push([e,middle]);bottom.push([e,middle])}
      const boundary=sign=>{let lo=0,hi=40;for(let k=0;k<10;k++){const y=(lo+hi)/2;if(field(x,middle+sign*y)<=0)lo=y;else hi=y}return middle+sign*(lo+hi)/2};
      const wave=Math.sin(x*.22)*energy;
      top.push([x,boundary(-1)+wave]);bottom.push([x,boundary(1)+wave]);
    }else if(top.length){const e=edge(previous,x);top.push([e,middle]);bottom.push([e,middle]);flush()}
    previous=x;
  }
  flush();return d;
}

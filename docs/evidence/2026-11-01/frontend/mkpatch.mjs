import fs from 'fs'; import zlib from 'zlib';
const a=fs.readFileSync(process.argv[2]), b=fs.readFileSync(process.argv[3]);
// greedy line-free diff: find common prefix/suffix iteratively with anchor search
const ops=[]; let i=0,j=0;
while(i<a.length||j<b.length){
  if(i<a.length&&j<b.length&&a[i]===b[j]){i++;j++;continue;}
  // mismatch: find resync
  let found=null;
  for(let d=1;d<6000&&!found;d++){
    for(let k=0;k<=d;k++){
      const x=i+k,y=j+(d-k);
      if(x+48<=a.length&&y+48<=b.length&&a.compare(b,y,y+48,x,x+48)===0){found=[x,y];break;}
    }
  }
  if(!found){ops.push([i,a.length-i,b.subarray(j).toString('base64')]);i=a.length;j=b.length;break;}
  ops.push([i,found[0]-i,b.subarray(j,found[1]).toString('base64')]);i=found[0];j=found[1];
}
const out=Buffer.from(JSON.stringify(ops));
console.log('ops',ops.length,'ins',ops.reduce((n,o)=>n+Buffer.from(o[2],'base64').length,0));
const z=zlib.gzipSync(out,{level:9}).toString('base64');
fs.writeFileSync(process.argv[4],z);console.log('b64',z.length);

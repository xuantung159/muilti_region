import struct,sys,hashlib,base64,json
b=open(sys.argv[1],'rb').read();x=json.load(open(sys.argv[2]))
e=b.rfind(b'PK\x05\x06');n,_,c=struct.unpack('<HII',b[e+10:e+20]);es=[];p=c
for _ in range(n):
    f=struct.unpack('<HHHHHHIIIHHHHHII',b[p+4:p+46]);L=46+f[9]+f[10]+f[11];nm=b[p+46:p+46+f[9]].decode()
    q=f[15];h=struct.unpack('<HH',b[q+26:q+30]);es.append((nm,f[6],f[8],f[7],f[3],b[q+30+h[0]+h[1]:q+30+h[0]+h[1]+f[7]]));p+=L
skip=('api/','monitoring/','dashboard/','authorizer/','exporter/','package.json','shared/')
import re,zlib
R=re.compile(r'^node_modules/@aws-sdk/core/dist-(es|types|types/ts3\.4)/submodules/protocols/json/(codec-v[12]/|(detectBufferParsing|jsonReplacer|jsonReviver|JsonSettings|needsReviver|parseJsonBody)\.)')
es=[z for z in es if not z[0].startswith(skip) and not R.match(z[0])]
for y in x:
    r=base64.b64decode(y['raw']);assert zlib.crc32(zlib.decompress(r,-15))==y['crc'] and len(r)==y['csize'],y['name']
    es.append((y['name'],y['crc'],y['size'],y['csize'],8,r))
es.sort(key=lambda z:z[0])
o=bytearray();cd=bytearray();T=(0<<11)|(0<<5);D=((2026-1980)<<9)|(11<<5)|1
for nm,crc,sz,cs,m,raw in es:
    a=nm.encode();off=len(o);d=nm.endswith('/');fl=0x800
    o+=b'PK\x03\x04'+struct.pack('<HHHHHIIIHH',20,fl,m,T,D,crc,cs,sz,len(a),0)+a+raw
    ea=((0o40755<<16)|0x10) if d else (0o100644<<16)
    cd+=b'PK\x01\x02'+struct.pack('<HHHHHHIIIHHHHHII',(3<<8)|20,20,fl,m,T,D,crc,cs,sz,len(a),0,0,0,0,ea,off)+a
co=len(o);o+=cd;o+=b'PK\x05\x06'+struct.pack('<HHHHIIH',0,0,len(es),len(es),len(cd),co,0)
open(sys.argv[3],'wb').write(o)
print(len(es),len(o),hashlib.sha256(o).hexdigest())

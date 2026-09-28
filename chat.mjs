import {parseLink,importLinkKey,decryptAsset} from './crypto.mjs';
async function open(){
  const status=document.querySelector('#status'),retry=document.querySelector('#retry');retry.hidden=true;
  try{
    const link=parseLink(location.hash);if(!link)throw new Error('Missing link');
    const key=await importLinkKey(link.bytes);link.bytes.fill(0);
    const response=await fetch('./assets/'+link.group+'.bin',{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
    if(!response.ok)throw new Error('Unavailable');
    const cipher=await response.arrayBuffer();if(cipher.byteLength>4096)throw new Error('Invalid route');
    const data=JSON.parse(new TextDecoder().decode(await decryptAsset(link.group,cipher,key)));
    const url=new URL(data.url);
    if(data.version!==1||url.protocol!=='https:'||url.port||url.username||url.password||!/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)||url.pathname!=='/'||!/^#connect=[A-Za-z0-9_-]{43}$/.test(url.hash))throw new Error('Invalid destination');
    location.replace(url.href);
  }catch{status.textContent='개발용 연결 링크 전체로 열어주세요. 연결이 바뀌는 중이면 잠시 후 다시 눌러주세요.';retry.hidden=false;}
}
document.querySelector('#retry').onclick=open;open();

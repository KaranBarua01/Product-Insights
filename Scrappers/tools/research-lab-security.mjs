/** Additional PC-only preflight controls. Not a DNS-pinned network sandbox. */
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

export function publicIp(address){
  if(isIP(address)===4){
    const [a,b,c]=address.split('.').map(Number);
    if(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a===192&&b===0&&(c===0||c===2)||a===198&&b===51&&c===100||a===203&&b===0&&c===113||a===192&&b===88&&c===99)return false;
    return true;
  }
  if(isIP(address)===6){
    const value=address.toLowerCase();
    if(value.includes('.')||value.includes('%')||value.startsWith('::ffff:'))return false;
    if(/^(?:2001:db8|2001:0db8)(?::|$)/i.test(value))return false;
    return /^[23][0-9a-f]{3}:/.test(value); // global unicast 2000::/3 only
  }
  return false;
}
export async function assertPublicDns(host,lookupFn=lookup){
  const addresses=await lookupFn(host,{all:true});
  if(!Array.isArray(addresses)||!addresses.length||addresses.some(a=>!publicIp(a.address)))throw Error('Hostname has private, reserved or invalid DNS results; blocked by local research preflight');
  return addresses.map(x=>x.address);
}
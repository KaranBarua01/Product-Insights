/* Runtime packages optional for offline fixture tests. */
declare module '@cloudflare/puppeteer' {
  const puppeteer:{launch(binding:unknown):Promise<{
    newPage():Promise<{setRequestInterception(enabled:boolean):Promise<void>;on(event:string,callback:(req:any)=>void):void;goto(url:string,options:{waitUntil:string;timeout:number}):Promise<unknown>;evaluate<T>(fn:(...args:any[])=>T|Promise<T>,...args:any[]):Promise<T>;url():string;content():Promise<string>;close():Promise<void>}>;
    close():Promise<void>;
  }>};export default puppeteer;
}
declare module 'unpdf'{
  export function getDocumentProxy(bytes:Uint8Array,options?:Record<string,unknown>):Promise<{numPages:number;destroy():Promise<void>}>;
  export function extractText(doc:unknown,options?:{mergePages?:boolean}):Promise<{text:string|string[];totalPages:number}>;
}

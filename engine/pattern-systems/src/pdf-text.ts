// Bounded PDF.js text-layer probe using at most eight pages; never fan out over an untrusted whole document.
export async function hasExtractablePdfText(bytes:Uint8Array):Promise<boolean|undefined>{
  if(bytes.byteLength<5||String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')return undefined;
  const {getDocumentProxy}=await import('unpdf');
  const pdf=await getDocumentProxy(new Uint8Array(bytes),{maxImageSize:8_388_608});
  try{
    if(pdf.numPages<1)return undefined;
    const pages=Math.min(pdf.numPages,8);
    let chars=0;
    for(let n=1;n<=pages;n++){
      const page=await pdf.getPage(n);
      const content=await page.getTextContent();
      for(const item of content.items){
        if('str' in item)chars+=item.str.replace(/\s/g,'').length;
      }
      if(chars>=30)return true;
    }
    return false; // absence only in inspected pages, never proof of a whole-document scanned PDF
  }finally{await (pdf as unknown as {destroy?:()=>Promise<unknown>|unknown}).destroy?.();}
}

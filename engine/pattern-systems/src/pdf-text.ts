// Validate real PDF text with a bounded parser. A PDF URL by itself does not prove a text layer.
export async function hasExtractablePdfText(bytes:Uint8Array):Promise<boolean|undefined>{
  if(bytes.byteLength<5||String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')return undefined;
  const {getDocumentProxy,extractText}=await import('unpdf');
  const pdf=await getDocumentProxy(new Uint8Array(bytes),{maxImageSize:8_388_608});
  try{
    if(pdf.numPages<1||pdf.numPages>8)return undefined; // require manual validation for oversized page counts
    const text=await extractText(pdf,{mergePages:false});
    const pages=Array.isArray(text.text)?text.text:[text.text];
    return pages.join(' ').replace(/\s/g,'').length>=30;
  }finally{const close=pdf as unknown as {destroy?:()=>Promise<unknown>|unknown};await close.destroy?.();}
}

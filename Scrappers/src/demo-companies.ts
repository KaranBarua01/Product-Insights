/* Approved live-demo research cases: strict exact-host list.
   Benchmark data is from isolated Node execution on 2026-11-12, not guaranteed Cloudflare results. */
export interface DemoCompany {
  name:string;
  url:string;
  source:'existing'|'Ajay'|'Research'|'Complete';
  ref:string;
  chars:number|null;
  evidence:number|null;
}
export const demoCompanies:ReadonlyArray<DemoCompany> = [
  {
    "name": "Saginaw Control & Engineering",
    "url": "https://www.saginawcontrol.com/",
    "source": "existing",
    "ref": "Original live integration test",
    "chars": 214,
    "evidence": 3
  },
  {
    "name": "Dometic",
    "url": "https://www.dometic.com/",
    "source": "existing",
    "ref": "Original prototype test site",
    "chars": null,
    "evidence": null
  },
  {
    "name": "PushCorp",
    "url": "https://pushcorp.com/",
    "source": "Ajay",
    "ref": "WEB-003",
    "chars": 13740,
    "evidence": 19
  },
  {
    "name": "PROENERGY Services",
    "url": "https://www.proenergyservices.com/",
    "source": "Research",
    "ref": "100-site benchmark",
    "chars": 9241,
    "evidence": 19
  },
  {
    "name": "Moog",
    "url": "https://www.moog.com/",
    "source": "Ajay",
    "ref": "100-site benchmark",
    "chars": 5850,
    "evidence": 13
  },
  {
    "name": "General Kinematics",
    "url": "https://www.generalkinematics.com/",
    "source": "Ajay",
    "ref": "100-site benchmark",
    "chars": 15016,
    "evidence": 16
  },
  {
    "name": "Hennig",
    "url": "https://hennigworldwide.com/",
    "source": "Research",
    "ref": "100-site benchmark",
    "chars": 19745,
    "evidence": 20
  },
  {
    "name": "Penticton Foundry",
    "url": "https://www.pentictonfoundry.com/",
    "source": "Complete",
    "ref": "100-site benchmark",
    "chars": 8916,
    "evidence": 16
  },
  {
    "name": "Vestil",
    "url": "https://vestil.com/",
    "source": "Complete",
    "ref": "100-site benchmark",
    "chars": 30028,
    "evidence": 16
  },
  {
    "name": "Blue Robotics",
    "url": "https://bluerobotics.com/",
    "source": "Complete",
    "ref": "100-site benchmark",
    "chars": 6924,
    "evidence": 16
  },
  {
    "name": "Hytrol",
    "url": "https://hytrol.com/",
    "source": "Complete",
    "ref": "100-site benchmark",
    "chars": 2925,
    "evidence": 13
  },
  {
    "name": "White Drive Products",
    "url": "https://whitedriveproducts.com/",
    "source": "Complete",
    "ref": "100-site benchmark",
    "chars": 5236,
    "evidence": 16
  },
  {
    "name": "Filamatic",
    "url": "https://www.filamatic.com/",
    "source": "Complete",
    "ref": "100-site benchmark",
    "chars": 6728,
    "evidence": 16
  },
  {
    "name": "EPC Power",
    "url": "https://www.epcpower.com/",
    "source": "Complete",
    "ref": "100-site benchmark",
    "chars": 28425,
    "evidence": 20
  }
];
const esc=(s:string):string=>s.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]??ch));
export const demoCompanySelectHtml = '<select id="site-select" aria-describedby="site-reference">'
  + '<optgroup label="Existing prototype sites">'
  + demoCompanies.filter(c=>c.source==='existing').map(c=>'<option value="'+esc(c.url)+'" data-source="existing" data-ref="'+esc(c.ref)+'">'+esc(c.name)+'</option>').join('')
  + '</optgroup><optgroup label="Additional websites from the 100-site research benchmark">'
  + demoCompanies.filter(c=>c.source!=='existing').map(c=>'<option value="'+esc(c.url)+'" data-source="'+esc(c.source)+'" data-ref="'+esc(c.ref)+'" data-chars="'+String(c.chars??0)+'" data-evidence="'+String(c.evidence??0)+'">'+esc(c.name)+'</option>').join('')
  + '</optgroup></select>';

// Real artifacts on Arkiv Rabdi, used across the site.
export const EXPLORER = "https://rabdi.explorer.arkiv.network";
export const CHAIN_ID = 7794095;

/** age >= 18 proof over a 180-day record (created 2026-11-07, live until ~May 2027). */
export const DEMO_PROOF = "/verify/0x814eb35926ead5e8ad0ea97ec7ce04ac4d26d1b7e446096ffdc316da3fa486db";

export const LIVE_LINKS: { label: string; href: string }[] = [
  { label: "Live proof (age ≥ 18)", href: DEMO_PROOF },
  { label: "Guardian-signed shred receipt", href: `${EXPLORER}/entity/0x5257a663ad161985d8a85a10529de28a7982a97ee568bba65d0e73ba069b41fc` },
  { label: "Month-level shred receipt", href: `${EXPLORER}/entity/0xf309ad37f75fdf7c2996ee0d360c2c25af5c14abcf3b7ca65d7bde8dba15dfbf` },
  { label: "Wallet used for live runs", href: `${EXPLORER}/address/0xBc670380edc8Ac07E91ca68cD6ac2Adf27881162` },
];

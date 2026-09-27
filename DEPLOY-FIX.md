# V1.4.0 Deploy Fix 1

Fixed Vercel/Next.js TypeScript build error:

`components/DriveVaultApp.tsx(421,5): error TS2322: Type 'number' is not assignable to type 'Timeout'.`

Changes:
- `scrollIdleTimer` now uses `useRef<number | null>`.
- `toastTimer` now uses `useRef<number | null>`.
- Browser timers consistently use `window.setTimeout()`.

No database or Google Apps Script migration is required for this fix.

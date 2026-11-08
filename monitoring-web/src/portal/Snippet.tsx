import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function Snippet({ title, code }: { title: string; code: string }) {
  const [notice, setNotice] = useState('');
  return <div className="code-window"><div className="code-bar justify-between"><span className="flex min-w-0 items-center gap-2.5"><span className="code-dots" aria-hidden><i /><i /><i /></span><h3 className="min-w-0 text-sm font-semibold">{title}</h3></span><button type="button" aria-label={`Sao chép: ${title}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-1 text-xs hover:bg-white/10" onClick={async () => {
    try { await navigator.clipboard.writeText(code); setNotice('Đã sao chép'); } catch { setNotice('Hãy chọn và sao chép đoạn mã bên dưới.'); }
  }}>{notice === 'Đã sao chép' ? <Check aria-hidden className="size-3.5 text-good" /> : <Copy aria-hidden className="size-3.5" />}Sao chép mẫu</button></div><pre className="overflow-x-auto p-3 text-xs leading-6"><code>{code}</code></pre><p role="status" className="px-3 pb-2 text-xs opacity-70 empty:hidden">{notice}</p></div>;
}

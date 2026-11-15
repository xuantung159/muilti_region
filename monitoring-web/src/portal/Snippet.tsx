import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

const COPIED = 'Đã sao chép';

export function Snippet({ title, code }: { title: string; code: string }) {
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (notice !== COPIED) return;
    const timer = setTimeout(() => setNotice(''), 2000);
    return () => clearTimeout(timer);
  }, [notice]);
  return <div className="code-window min-w-0">
    <div className="code-bar justify-between">
      <span className="flex min-w-0 flex-1 items-center gap-2.5"><span className="code-dots" aria-hidden><i /><i /><i /></span><h3 className="min-w-0 break-words text-sm leading-5 font-semibold">{title}</h3></span>
      <button type="button" aria-label={`Sao chép: ${title}`} title="Sao chép mẫu" className="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 self-center rounded-md border border-white/20 px-2 py-1 text-xs whitespace-nowrap hover:bg-white/10 sm:px-2.5" onClick={async () => {
        try { await navigator.clipboard.writeText(code); setNotice(COPIED); } catch { setNotice('Hãy chọn và sao chép đoạn mã bên dưới.'); }
      }}>{notice === COPIED ? <Check aria-hidden className="size-3.5 text-good" /> : <Copy aria-hidden className="size-3.5" />}<span className="max-sm:sr-only">{notice === COPIED ? COPIED : 'Sao chép mẫu'}</span></button>
    </div>
    {/* tabIndex cho phép cuộn ngang bằng bàn phím khi dòng mã dài hơn khung. */}
    <pre tabIndex={0} className="max-h-[32rem] overflow-auto p-3 text-xs leading-6 whitespace-pre focus-visible:outline-offset-[-2px]"><code>{code}</code></pre>
    <p role="status" className={notice === COPIED ? 'sr-only' : 'px-3 pb-2 text-xs opacity-70 empty:hidden'}>{notice}</p>
  </div>;
}

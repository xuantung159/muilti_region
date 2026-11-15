import { ArrowLeft, ArrowRight, Code2, Download } from 'lucide-react';
import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, Tag } from '../components/ui';
import { ENDPOINTS } from '../data/deployment';
import { Snippet } from './Snippet';
import { DEMO_LANGUAGES, type DemoLanguage } from './demoLanguages';

const CurrentStep = createContext(1);

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  const active = useContext(CurrentStep);
  if (active !== number) return null;
  return <section id={`project-step-${number}`} className="scroll-mt-20 rounded-xl border border-line p-4 sm:p-5">
    <h3 className="mb-4 flex items-center gap-3 text-base leading-snug font-semibold"><span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold tabular-nums text-on-accent">{number}</span><span className="min-w-0">{title}</span></h3>
    <div className="space-y-3 text-sm leading-6">{children}</div>
  </section>;
}
// Giữ cờ dòng lệnh như --env-file trên một dòng thay vì tách tại dấu gạch.
function NoBreakFlags({ text }: { text: string }) {
  return <>{text.split(/(--[\w-]+)/).map((part, index) => index % 2 ? <code key={index} className="whitespace-nowrap">{part}</code> : <Fragment key={index}>{part}</Fragment>)}</>;
}

const STEP_TITLES = ['Chuẩn bị project', 'Kiểm tra backend', 'Đăng nhập portal', 'Đăng ký API đích', 'Tạo API key', 'Cấu hình .env', 'Chạy project', 'Kiểm tra báo cáo'];

const todo = `{
  "userId": 1,
  "id": 1,
  "title": "delectus aut autem",
  "completed": false
}`;

export function SampleWalkthrough() {
  const [language, setLanguage] = useState<DemoLanguage>('javascript');
  const [step, setStep] = useState(1);
  const demo = DEMO_LANGUAGES[language];
  const nav = useRef<HTMLElement>(null);
  // Trên mobile thanh bước cuộn ngang: đưa bước đang chọn vào khung nhìn mà không cuộn cả trang.
  useEffect(() => {
    const list = nav.current, active = list?.querySelector<HTMLElement>('[aria-current=step]');
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2, behavior: 'smooth' });
  }, [step]);
  return <section id="guide-sample" className="scroll-mt-20"><Card className="space-y-5 max-sm:px-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="guide-eyebrow">BÀI THỰC HÀNH · API TODO</p><h2 className="mt-1 text-lg font-semibold">Từ project của bạn đến gateway</h2></div><Tag tone="accent">8 bước · Không cần dựng backend</Tag></div>
    <p className="text-sm text-ink2">Chọn ngôn ngữ quen thuộc. Mỗi project gọi cùng API Todo qua gateway thật và giữ API key ở server. Các lệnh bên dưới dành cho PowerShell trên Windows.</p>
    <div className="guide-language-picker" role="group" aria-label="Ngôn ngữ project demo">{Object.entries(DEMO_LANGUAGES).map(([id, item]) => <button type="button" key={id} aria-label={item.label} aria-pressed={language === id} onClick={() => setLanguage(id as DemoLanguage)}><Code2 aria-hidden className="size-4" /><span><strong>{item.label}</strong><small>{item.version}</small></span></button>)}</div>
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-page p-3 text-center text-xs text-ink2 sm:flex-row sm:gap-3"><span className="rounded-md border border-line bg-surface px-2.5 py-1 font-medium text-ink">Project {demo.label}</span><ArrowRight aria-hidden className="size-4 shrink-0 rotate-90 sm:rotate-0" /><span className="rounded-md border border-line bg-surface px-2.5 py-1 font-medium text-ink">Gateway + API key</span><ArrowRight aria-hidden className="size-4 shrink-0 rotate-90 sm:rotate-0" /><span className="rounded-md border border-line bg-surface px-2.5 py-1 font-medium text-ink">JSONPlaceholder</span></div>
    <CurrentStep.Provider value={step}><div className="project-wizard">
    <nav ref={nav} aria-label="Các bước tích hợp project" className="project-step-nav">{STEP_TITLES.map((title, i) => <button type="button" key={title} aria-current={step === i + 1 ? 'step' : undefined} onClick={() => setStep(i + 1)}><span>{String(i + 1).padStart(2, '0')}</span>{title}</button>)}</nav>
    <div className="project-panel"><div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-ink2"><span aria-live="polite" className="font-semibold tracking-wider text-accent">BƯỚC {step} / 8</span><span className="text-muted">{demo.label} · {demo.version}</span></div>
    <Step number={1} title="Tải và mở project mẫu">
      <p>Cài <strong>{demo.version}</strong> từ <a className="text-accent underline" href={demo.download} target="_blank" rel="noreferrer">trang tải {demo.label}</a>. Tải project, giải nén và mở PowerShell trong thư mục có <code>{demo.file}</code> và <code>.env.example</code>.</p>
      <a className="btn-primary w-fit" href={`/samples/${demo.zip}`} download><Download aria-hidden className="size-4" />Tải project {demo.label} (.zip)</a>
      <Snippet title="Kiểm tra công cụ và vị trí thư mục" code={`${demo.check}\nGet-ChildItem -Force${language === 'go' ? '\ngo test ./...' : ''}`} />
      <p className="guide-result"><strong>Cần thấy:</strong> đúng phiên bản công cụ và file {demo.file}. <NoBreakFlags text={demo.tools} /></p>
    </Step>
    <Step number={2} title="Kiểm tra backend trước khi đi qua gateway">
      <Snippet title="Gọi trực tiếp API Todo công khai" code={'curl.exe -i --max-time 15 https://jsonplaceholder.typicode.com/todos/1'} />
      <p>Cần thấy HTTP 200 và Todo có <code>id: 1</code>. Đây mới là kiểm tra backend, chưa dùng gateway hay API key và chưa tăng thống kê doanh nghiệp.</p>
      <Snippet title="Body Todo để đối chiếu" code={todo} />
    </Step>
    <Step number={3} title="Đăng nhập Cổng doanh nghiệp bằng tài khoản thật">
      <p>Mở <Link className="text-accent underline" to="/portal">Cổng doanh nghiệp</Link>. Nếu đang có nhãn “DEMO PORTAL”, bấm <strong>Thoát demo, dùng tài khoản thật</strong>. Đăng nhập; nếu chưa có tài khoản, chọn <strong>Chưa có tài khoản? Đăng ký doanh nghiệp</strong> và điền tên doanh nghiệp, email, mật khẩu.</p>
      <p className="text-ink2">Cần thấy tên doanh nghiệp của bạn cùng các tab Tổng quan, API đích, API key, Hướng dẫn. Bấm Hướng dẫn để quay lại bài này. “Trải nghiệm demo” chỉ tạo dữ liệu trong trình duyệt; key DEMO_ONLY không dùng cho các lệnh thật bên dưới.</p>
    </Step>
    <Step number={4} title="Đăng ký API Todo trong tab API đích">
      <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full text-left"><thead><tr className="border-b border-line bg-raised text-xs text-ink2"><th className="p-2">Trường trên portal</th><th className="p-2">Giá trị cần nhập</th></tr></thead><tbody>{[['Tên API', 'API Todo demo'], ['URL backend', 'https://jsonplaceholder.typicode.com'], ['Timeout (ms)', '5000']].map(([label, value]) => <tr key={label} className="border-b border-line last:border-0"><td className="p-2">{label}</td><td className="break-all p-2 font-mono text-xs">{value}</td></tr>)}</tbody></table></div>
      <p>Bấm <strong>Đăng ký API</strong>. Trong thẻ API Todo demo vừa xuất hiện, kiểm tra <strong>Đang bật</strong>, rồi sao chép chuỗi sau <strong>ID:</strong>. Gọi chuỗi này là <code>API_ID_CUA_BAN</code>.</p>
      <p className="text-ink2">URL backend chỉ là địa chỉ gốc, không thêm /todos/1. Gateway ghép đường dẫn ở bước 7. API ID do portal cấp riêng cho tài khoản; không lấy ID từ ảnh hoặc lần kiểm thử của người khác.</p>
    </Step>
    <Step number={5} title="Tạo API key cho đúng API của project">
      <ol className="list-decimal space-y-2 pl-5"><li>Mở tab <strong>API key</strong>, nhập <strong>Tên ứng dụng: Project {demo.label} Todo</strong>.</li><li>Trong <strong>API được phép gọi</strong>, tích <strong>API Todo demo</strong> vừa đăng ký.</li><li>Bấm <strong>Tạo key</strong>. Sao chép ngay toàn bộ giá trị bắt đầu bằng <code>mrk_</code> trong khung “Sao chép ngay — key chỉ hiển thị một lần”.</li><li>Giữ trang này mở tới khi điền xong .env ở bước 6. Đổi tab sẽ ẩn secret; danh sách key chỉ còn ID, không khôi phục được secret.</li></ol>
      <p className="guide-result"><strong>Cần thấy:</strong> Project {demo.label} Todo · Đang dùng, có phạm vi API Todo demo. Nếu mất secret, tạo key khác cho cùng API rồi cập nhật .env.</p>
    </Step>
    <Step number={6} title="Đưa cấu hình portal vào file .env của project">
      <Snippet title={`Tạo cấu hình trong project ${demo.label}`} code={'Copy-Item .env.example .env\nnotepad .env'} />
      <p>Trong Notepad, thay API_ID_CUA_BAN bằng ID ở bước 4; thay DAN_KEY_MRK_CUA_BAN bằng toàn bộ key ở bước 5. Lưu bằng Ctrl+S rồi đóng Notepad. Nếu đã có .env, chỉ mở và sửa, không chạy lại Copy-Item để tránh ghi đè cấu hình cũ.</p>
      <Snippet title="Ba dòng cần điền trong .env" code={`MRAPI_GATEWAY_URL=${ENDPOINTS.api}\nMRAPI_API_ID=API_ID_CUA_BAN\nMRAPI_API_KEY=DAN_KEY_MRK_CUA_BAN`} />
      <p className="text-ink2">File tên đúng .env, cùng thư mục {demo.file}; không phải .env.txt. Dán giá trị không kèm dấu nháy. File .gitignore đã loại .env. Gateway URL khác URL backend ở bước 4; không đưa key vào frontend hoặc ảnh chụp.</p>
    </Step>
    <Step number={7} title="Chạy project và đối chiếu kết quả thật">
      <Snippet title={`Chạy project ${demo.label}`} code={demo.run} />
      <p>Project đọc .env, gọi <code>/proxy/API_ID_CUA_BAN/todos/1</code> với header <code>x-api-key</code>. Không cần sửa {demo.file} và không đặt key vào lệnh.</p>
      {demo.source && <details className="rounded-xl border border-line p-3 max-sm:p-2"><summary className="cursor-pointer px-1 font-semibold">Xem mã nguồn {demo.file}</summary><div className="mt-3"><Snippet title={demo.file} code={demo.source} /></div></details>}
      <Snippet title="Kết quả cần đối chiếu (thời gian và region có thể khác)" code={`HTTP 200 | ... ms | region: ap-southeast-1\n${todo}`} />
      <p className="text-ink2">Cần HTTP 200 và cùng nội dung Todo ở bước 2. Thời gian và region có thể khác: domain api.multi-region.io.vn định tuyến theo vị trí/độ trễ và health. Tạo thêm 5 lượt gọi cho biểu đồ bằng lệnh:</p>
      <Snippet title="Gửi thêm traffic để xem thống kê" code={`1..5 | ForEach-Object { ${demo.run} }`} />
    </Step>
    <Step number={8} title="Chứng minh bảo vệ API và xem báo cáo trên web">
      <p>Thay API_ID_CUA_BAN trong lệnh dưới bằng ID ở bước 4. Lệnh cố ý không gửi key để chứng minh gateway từ chối:</p>
      <Snippet title="Thử thiếu API key — kết quả cần thấy HTTP 401" code={`curl.exe -i --max-time 15 "${ENDPOINTS.api}/proxy/API_ID_CUA_BAN/todos/1"`} />
      <ol className="list-decimal space-y-2 pl-5"><li>Quay lại portal → <strong>Tổng quan</strong> → <strong>1 giờ</strong> → <strong>Làm mới</strong>. Xem tổng lượt gọi, biểu đồ, region và key Project {demo.label} Todo. Chờ một lúc rồi làm mới nếu số liệu chưa cập nhật.</li><li>Request thiếu/sai key bị chặn trước proxy nên không tăng thống kê proxy.</li><li>Mở <Link className="text-accent underline" to="/incidents">Failover &amp; Incidents</Link> hoặc <Link className="text-accent underline" to="/regions">Multi-Region</Link>. Báo cáo yêu cầu đăng nhập và có API key đang dùng.</li></ol>
      <p className="text-ink2">Tùy chọn: thu hồi key thử riêng rồi chạy lại lệnh ở bước 7, cần bị từ chối 401/403. Không thu hồi key của ứng dụng đang sử dụng. Nếu mất key hoạt động cuối cùng, báo cáo sẽ yêu cầu tạo key mới.</p>
    </Step>
    <div className="project-step-footer"><button type="button" className="chip whitespace-nowrap" disabled={step === 1} onClick={() => setStep(step - 1)}><ArrowLeft aria-hidden className="size-4 shrink-0" />Bước trước</button><span aria-hidden className="text-xs whitespace-nowrap text-muted tabular-nums">{step} / 8</span><button type="button" className="btn-primary whitespace-nowrap" disabled={step === 8} onClick={() => setStep(step + 1)}>Bước tiếp<ArrowRight aria-hidden className="size-4 shrink-0" /></button></div>
    </div></div></CurrentStep.Provider>
    <details className="guide-evidence"><summary>Kết quả đã kiểm chứng trên AWS <span>10/11/2026</span></summary><div className="space-y-3 pt-4">
    <div className="rounded-xl border border-good/40 bg-good/5 p-4 text-sm"><h3 className="font-semibold">Kết quả thực tế đã lưu · 10/11/2026</h3><p className="mt-2 text-ink2">Đã dùng project_test với API có sẵn trên portal, cùng backend và route /todos/1. Không đăng ký tài khoản mới hoặc tạo key mới trong lần kiểm chứng này.</p><div className="mt-3 overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-line"><th className="p-2">Kiểm tra</th><th className="p-2">HTTP</th><th className="p-2">Region trả về</th></tr></thead><tbody>{[['Backend trực tiếp', '200', 'Không qua gateway'], ['Gateway Singapore', '200', 'ap-southeast-1'], ['Gateway Tokyo', '200', 'ap-northeast-1'], ['Domain api.multi-region.io.vn', '200', 'ap-southeast-1'], ['Thiếu key', '401', 'Chặn trước proxy'], ['Sai key', '401', 'Chặn trước proxy']].map(([name, status, region]) => <tr key={name} className="border-b border-line"><td className="p-2">{name}</td><td className="p-2">{status}</td><td className="p-2">{region}</td></tr>)}</tbody></table></div><p className="mt-2 text-xs text-muted">Kết quả một lần chạy đã lưu, không phải trạng thái thời gian thực. Bài này kiểm chứng tích hợp và truy cập; không tạo sự cố hay chứng minh failover khi region hỏng.</p></div>
    <p className="text-sm text-ink2">Đã đối chiếu bản ghi telemetry của lần kiểm chứng: 3 request thành công ở Singapore và 1 ở Tokyo cho /todos/1. Đây là các bản ghi đã lưu, không phải tổng lượt gọi hiện tại của tài khoản bạn.</p>
    <div className="rounded-xl bg-raised p-4 text-sm"><h3 className="font-semibold">Project bổ sung đã chạy thật</h3><p className="mt-2 text-ink2">Đã giải nén từng gói tải xuống, dùng cùng API/key hiện có và gọi /todos/1 ngày 10/11/2026.</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{[['JavaScript', '1936 ms'], ['Java', '1023 ms'], ['Python', '581 ms']].map(([name, duration]) => <div key={name} className="rounded-lg border border-line p-3"><strong>{name}</strong><p className="mt-1 text-good">HTTP 200</p><p className="text-xs text-muted">ap-southeast-1 · {duration}</p></div>)}</div></div>
    </div></details>
    <details className="guide-evidence"><summary>Gặp lỗi? Kiểm tra nhanh</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-sm"><li><strong>Không nhận diện công cụ:</strong> cài {demo.version}, mở lại PowerShell và chạy {demo.check}.</li><li><strong>Thiếu cấu hình:</strong> mở đúng thư mục {demo.file}; kiểm tra .env và 3 biến MRAPI_. Biến môi trường đặt trước được ưu tiên hơn file.</li><li><strong>401/403:</strong> kiểm tra secret mrk_, API ID, phạm vi và trạng thái key.</li><li><strong>404:</strong> bài này dùng /todos/1; không dùng /orders.</li><li><strong>502/504:</strong> thử backend trực tiếp ở bước 2; kiểm tra URL backend và timeout.</li><li><strong>Chưa có thống kê:</strong> gọi qua /proxy/, chọn 1 giờ và Làm mới.</li></ul></details>
  </Card></section>;
}

import javascript from './demo-projects/javascript/main.mjs?raw';
import python from './demo-projects/python/main.py?raw';
import java from './demo-projects/java/Main.java?raw';

export const DEMO_LANGUAGES = {
  go: { label: 'Go', version: 'Go 1.22+', file: 'main.go', check: 'go version', run: 'go run . /todos/1', zip: 'project-mau-mrapi.zip', source: '', tools: 'Không cần package ngoài. Project tự đọc .env.', download: 'https://go.dev/dl/' },
  javascript: { label: 'JavaScript', version: 'Node.js 22+', file: 'main.mjs', check: 'node --version', run: 'node --env-file=.env main.mjs', zip: 'mrapi-javascript.zip', source: javascript, tools: 'Chạy trên Node.js ở server. Không cần npm install; --env-file nạp cấu hình.', download: 'https://nodejs.org/en/download' },
  java: { label: 'Java', version: 'JDK 17+', file: 'Main.java', check: 'java --version', run: 'java Main.java', zip: 'mrapi-java.zip', source: java, tools: 'Dùng HTTP client có sẵn trong JDK. Không cần Maven hoặc Gradle; chương trình tự đọc .env.', download: 'https://adoptium.net/temurin/releases/' },
  python: { label: 'Python', version: 'Python 3.10+', file: 'main.py', check: 'python --version', run: 'python main.py', zip: 'mrapi-python.zip', source: python, tools: 'Chỉ dùng thư viện chuẩn. Không cần pip install; chương trình tự đọc .env.', download: 'https://www.python.org/downloads/' },
} as const;
export type DemoLanguage = keyof typeof DEMO_LANGUAGES;

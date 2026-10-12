// يُحمَّل أولًا: بيئة شبيهة بـ Node لكود الخادم داخل المتصفح.
(globalThis as any).process = { env: { TEACHER_PASSWORD: 'preview' }, cwd: () => '/', exit() {} };

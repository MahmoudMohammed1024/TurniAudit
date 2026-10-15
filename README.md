# 🛡️ TurniAudit Forensic Engine
### محرّك التحقيق الجنائي الرقمي الصارم لفحص تقارير Turnitin

نظام مفتوح المصدر لفحص تقارير كشف الذكاء الاصطناعي (AI Writing Reports) ونسب الاقتباس (Similarity Reports) الصادرة من منصة **Turnitin**، مُصمم وفق مبدأ **"العدالة الجنائية الرقمية"** لضمان عدم ظلم أي طالب أو مستند أصلي نهائياً (**Zero False Positives**)، وفي نفس الوقت كشف أدوات التزوير والقص والدمج بنسبة 100%.

---

## 🚀 المميزات الرئيسية
* **⚡ فحص محلي 100% داخل المتصفح (Client-Side Forensics):** يتم تشريح ملف الـ PDF بالكامل داخل متصفح المستخدم دون رفعه إلى أي خادم خارجي (أمان وخصوصية كاملة لبيانات الطلاب والأبحاث).
* **⚖️ معمارية العدالة الرقمية (4-Tier Justice Architecture):**
  1. `AUTHENTIC_OFFICIAL`: تقارير أصلية ومعتمدة رسمياً صادرة عبر محرك Turnitin الحديث (`pdf-lib`) أو طباعة المتصفح.
  2. `TAMPERED_OR_INCOMPLETE`: تقارير حُذفت منها صفحة الغلاف الإلزامية أو أُعيد حفظها بمكتبة بايثون (`pypdf`).
  3. `FABRICATED_FORGERY`: تقارير مزورة ومصطنعة كلياً بقوالب خارجية تحمل بصمات الخطوط الوهمية (`NotoR`, `LexSB`).
  4. `SUSPICIOUS_MANUAL_REVIEW`: تقارير مشبوهة غير مكتملة المعايير يوصى فيها بالفحص اليدوي لدرء الشبهات.
* **🌐 جاهز للنشر الفوري على GitHub Pages بنقرة واحدة.**
* **🐍 محرك بايثون مكتبي إضافي (`turnitin_auditor.py`) للاستخدام في السيرفرات وروبوتات التيليجرام.**

---

## 📁 هيكلية المشروع
```
├── index.html              # واجهة الويب التفاعلية
├── style.css               # التصميم المودرن (Dark Glassmorphic UI)
├── app.js                  # محرك الفحص الجنائي لجهة المتصفح (PDF.js + Binary Byte Inspection)
├── turnitin_auditor.py     # محرك بايثون المستقل للربط مع السيرفرات وروبوتات التيليجرام
└── README.md               # دليل التشغيل والتوثيق
```

---

## 🌐 تفعيل الموقع على GitHub Pages
1. ارفع المشروع إلى مستودعك على GitHub.
2. اذهب إلى إعدادات المستودع **Settings** -> **Pages**.
3. في خانة **Branch** اختر `main` أو `master` واضغط **Save**.
4. سيظهر لك رابط الموقع المباشر (مثل: `https://username.github.io/repository-name/`).

---

## 🐍 تشغيل محرك بايثون (Python CLI)
```bash
python turnitin_auditor.py "path/to/report.pdf"
```

نموذج استجابة بايثون:
```json
{
  "filename": "report.pdf",
  "verdict": "AUTHENTIC_OFFICIAL",
  "verdict_title": "تقرير أصلي ورسمي معتمد (Authentic Official)",
  "confidence_pct": 98,
  "report_type": "Turnitin AI Writing Report",
  "submission_id": "trn:oid:::3618:152091199",
  "detected_score": "*%",
  "is_clean_official": true,
  "recommendation": "التقرير سليم وقانوني ومطابق 100% لمعايير التصدير الرسمية لمنصة Turnitin."
}
```

---

## 📜 الترخيص
المشروع متاح للاستخدام الأكاديمي والبحثي تحت رخصة **MIT**.

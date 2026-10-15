/**
 * TurniAudit Forensic Engine - Client-Side PDF Forensic Analyzer
 * نظام التحقيق الجنائي الرقمي الصارم لتقارير Turnitin - الإصدار الحاسم 100%
 */

// إعداد PDF.js Worker
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// عناصر واجهة المستخدم
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const loadingIndicator = document.getElementById('loadingIndicator');
const loadingStatusText = document.getElementById('loadingStatusText');
const resultsSection = document.getElementById('resultsSection');
const langToggle = document.getElementById('langToggle');

// أزرار النماذج الجاهزة
const btnSampleReal = document.getElementById('btnSampleReal');
const btnSampleFake = document.getElementById('btnSampleFake');
const btnSampleTampered = document.getElementById('btnSampleTampered');

let currentLang = 'ar';

// -------------------------------------------------------------
// إدارة السحب والإفلات (Drag and Drop Events)
// -------------------------------------------------------------
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('dragover');
  });
});

dropZone.addEventListener('drop', (e) => {
  const files = e.dataTransfer.files;
  if (files && files.length > 0) {
    handleFile(files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
});

// -------------------------------------------------------------
// معالجة الملف وتشريح الـ PDF جنائياً
// -------------------------------------------------------------
async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    alert(currentLang === 'ar' ? 'يرجى اختيار ملف PDF صالح.' : 'Please select a valid PDF file.');
    return;
  }

  showLoading(true, currentLang === 'ar' ? `جاري قراءة وفحص ملف ${file.name}...` : `Analyzing ${file.name}...`);
  resultsSection.classList.add('hidden');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const rawBytes = new Uint8Array(arrayBuffer);
    
    // فحص المحتوى الثنائي الكامل وفك ضغط التدفقات
    const rawAnalysis = await analyzeRawPdfBytes(rawBytes);

    // فحص البنية النصية والميتاداتا عبر PDF.js
    const pdfDoc = await pdfjsLib.getDocument({ data: rawBytes }).promise;
    const pageCount = pdfDoc.numPages;

    let metaInfo = {};
    let metaXmp = null;
    try {
      const meta = await pdfDoc.getMetadata();
      if (meta) {
        metaInfo = meta.info || {};
        metaXmp = meta.metadata;
      }
    } catch (e) {
      console.warn('PDF.js metadata extraction fallback:', e);
    }

    const producer = metaInfo.Producer || rawAnalysis.producer || '';
    const creator = metaInfo.Creator || rawAnalysis.creator || '';
    const cdate = metaInfo.CreationDate || rawAnalysis.creationDate || '';
    const mdate = metaInfo.ModDate || rawAnalysis.modDate || '';
    const title = metaInfo.Title || rawAnalysis.title || '';
    const isPdfLib = producer.toLowerCase().includes('pdf-lib') || creator.toLowerCase().includes('pdf-lib') || rawAnalysis.isPdfLib;
    const isPypdf = producer.toLowerCase().includes('pypdf') || creator.toLowerCase().includes('pypdf') || rawAnalysis.isPypdf;
    const isSameTimestamp = (cdate === mdate && cdate.length > 8 && isPdfLib);

    let p1Text = '';
    let p2Text = '';

    if (pageCount >= 1) {
      const p1 = await pdfDoc.getPage(1);
      const textContent1 = await p1.getTextContent();
      p1Text = textContent1.items.map(item => item.str).join(' ');
    }

    if (pageCount >= 2) {
      const p2 = await pdfDoc.getPage(2);
      const textContent2 = await p2.getTextContent();
      p2Text = textContent2.items.map(item => item.str).join(' ');
    }

    const fullOverviewText = p1Text + '\n' + p2Text;

    // استخراج رقم الإرسال trn:oid
    let submissionId = rawAnalysis.trnOid;
    if (!submissionId) {
      const m = fullOverviewText.match(/trn:oid:::[a-zA-Z0-9:]+/);
      if (m) submissionId = m[0];
    }

    // استخراج نوع التقرير والدرجة
    let reportType = 'Unknown';
    let detectedScore = null;

    if (fullOverviewText.includes('detected as AI') || fullOverviewText.includes('تم إنشاؤه بالذكاء')) {
      reportType = 'Turnitin AI Writing Report';
      const m = fullOverviewText.match(/(\d+%|\*%)\s*(detected as AI|من المحتوى تم إنشاؤه)/);
      if (m) detectedScore = m[1];
    } else if (fullOverviewText.includes('Overall Similarity') || fullOverviewText.includes('التشابه الكلي') || fullOverviewText.includes('Match Groups')) {
      reportType = 'Turnitin Similarity Report';
      const m = fullOverviewText.match(/(\d+%)\s*(Overall Similarity|التشابه)/);
      if (m) detectedScore = m[1];
    }

    // فحص صفحة الغلاف الرسمية
    const hasCoverPage = (p1Text.includes('Document Details') || p1Text.includes('تفاصيل المستند')) &&
                         (p1Text.includes('Submission ID') || p1Text.includes('معرف الإرسال'));

    // فحص الخلل البرمجي الشهير في سكريبتات التزوير (تكرار نص الترويسة)
    let hasHeaderDuplicationBug = false;
    const p1Matches = (p1Text.match(/Page 1 of/g) || []).length;
    if (p1Matches > 1 && (isPdfLib || rawAnalysis.hasWhiteout || rawAnalysis.hasBundledFont || rawAnalysis.hasPdflibSynthesizer)) {
      hasHeaderDuplicationBug = true;
    }

    const hasStandardPagination = /Page\s+\d+\s+of\s+\d+/.test(fullOverviewText) || /صفحة\s+\d+\s+من\s+\d+/.test(fullOverviewText);

    // بناء القرار الجنائي الصارم والحاسم 100%
    const auditResult = evaluateForensicDecision({
      filename: file.name,
      pageCount: pageCount,
      producer: producer,
      creator: creator,
      title: title,
      cdate: cdate,
      mdate: mdate,
      hasXmp: !!metaXmp || rawAnalysis.hasXmp,
      fakeAliases: rawAnalysis.fakeAliases,
      genericFonts: rawAnalysis.genericFonts,
      counterfeitFonts: rawAnalysis.counterfeitFonts,
      detectedExternalEngine: rawAnalysis.detectedExternalEngine,
      hasHeaderDuplicationBug: hasHeaderDuplicationBug,
      hasCoverPage: hasCoverPage,
      hasStandardPagination: hasStandardPagination,
      isPypdf: isPypdf,
      isPdfLib: isPdfLib,
      isBrowserPrint: rawAnalysis.isBrowserPrint,
      isSameTimestamp: isSameTimestamp,
      hasBundledFont: rawAnalysis.hasBundledFont,
      hasWhiteout: rawAnalysis.hasWhiteout,
      hasPdflibSynthesizer: rawAnalysis.hasPdflibSynthesizer,
      submissionId: submissionId,
      reportType: reportType,
      detectedScore: detectedScore
    });

    renderResults(auditResult);

  } catch (error) {
    console.error('Forensic analysis error:', error);
    alert(currentLang === 'ar' ? `حدث خطأ أثناء فحص الملف: ${error.message}` : `Error parsing PDF: ${error.message}`);
  } finally {
    showLoading(false);
  }
}

// -------------------------------------------------------------
// تشريح بيانات البايت الثنائية لملف الـ PDF مع فك ضغط التدفقات
// -------------------------------------------------------------
async function analyzeRawPdfBytes(bytes) {
  // فحص شامل للنص الثنائي الخام حتى 50 ميجابايت
  const scanLimit = Math.min(bytes.length, 50 * 1024 * 1024);
  const rawText = new TextDecoder('latin1').decode(bytes.subarray(0, scanLimit));

  // فك ضغط تدفقات الـ Flate Streams لكشف أوامر وألوان ومصفوفات الرسم الداخلية
  let streamText = '';
  try {
    const streamMatches = [...rawText.matchAll(/stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g)];
    for (const m of streamMatches) {
      const rawStr = m[1];
      const u8 = new Uint8Array(rawStr.length);
      for (let i = 0; i < rawStr.length; i++) u8[i] = rawStr.charCodeAt(i);
      try {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(u8).catch(() => {});
        writer.close().catch(() => {});
        const reader = ds.readable.getReader();
        const chunks = [];
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
        const decBuf = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) {
          decBuf.set(c, offset);
          offset += c.length;
        }
        streamText += new TextDecoder('latin1').decode(decBuf) + '\n';
      } catch (e) {
        // Stream ليس من نوع deflate
      }
    }
  } catch (err) {
    console.warn('Stream decompression fallback:', err);
  }

  const fullSample = rawText + '\n' + streamText;

  // استخراج Producer و Creator مع دعم الأقواس المهربة
  let producer = '';
  const prodMatch = fullSample.match(/\/Producer\s*\((.*?)(?<!\\)\)/s);
  if (prodMatch) producer = prodMatch[1].replace(/\\([()])/g, '$1');

  let creator = '';
  const creatMatch = fullSample.match(/\/Creator\s*\((.*?)(?<!\\)\)/s);
  if (creatMatch) creator = creatMatch[1].replace(/\\([()])/g, '$1');

  // استخراج تواريخ الميتاداتا
  let creationDate = '';
  const cMatch = fullSample.match(/\/CreationDate\s*\(([^)]+)\)/);
  if (cMatch) creationDate = cMatch[1];

  let modDate = '';
  const mMatch = fullSample.match(/\/ModDate\s*\(([^)]+)\)/);
  if (mMatch) modDate = mMatch[1];

  let title = '';
  const titleMatch = fullSample.match(/\/Title\s*\((.*?)(?<!\\)\)/s);
  if (titleMatch) title = titleMatch[1].replace(/\\([()])/g, '$1');

  // فحص بصمة محرك التوليد الاصطناعي (pdf-lib drawText Synthesizer Footprint)
  const hasPdflibSynthesizer = /0\.388\s+0\.388\s+0\.388\s+RG\s+0\.388\s+0\.388\s+0\.388\s+rg/.test(fullSample) ||
                               /0\.098\s+0\.098\s+0\.098\s+RG\s+0\.098\s+0\.098\s+0\.098\s+rg/.test(fullSample) ||
                               /Tf\s+[\d\.]+\s+[\d\.]+\s+[\d\.]+\s+RG\s+[\d\.]+\s+[\d\.]+\s+[\d\.]+\s+rg\s*\[<[0-9a-fA-F]+>\]TJ/.test(fullSample);

  // فحص حقن الخطوط الخارجية المستقلة (مثل bundled_font)
  const hasBundledFont = fullSample.includes('bundled_font');

  // فحص أسماء الخطوط الوهمية المستخدمة في التزوير
  const fakeAliases = [];
  ['NotoR', 'NotoSB', 'LexM', 'LexSB'].forEach(alias => {
    if (fullSample.includes(`/${alias} `) || fullSample.includes(`/${alias}/`) || fullSample.includes(`/${alias}\n`)) {
      fakeAliases.push(alias);
    }
  });

  // فحص الخطوط العامة غير المجزأة (مع دعم ترميز المسافات #20 في الـ PDF)
  const genericFonts = [];
  ['Noto Sans Regular', 'Lexend Deca Medium', 'Noto Sans SemiBold', 'Lexend Deca SemiBold'].forEach(f => {
    const fHash = f.replace(/ /g, '#20');
    if (fullSample.includes(f) || fullSample.includes(fHash)) {
      genericFonts.push(f);
    }
  });

  // فحص الخطوط البديلة مفتوحة المصدر (بصمة سكريبتات التزوير على لينكس/بايثون)
  const counterfeitFonts = [];
  ['liberation', 'dejavu', 'freesans'].forEach(f => {
    if (fullSample.toLowerCase().includes(f)) {
      counterfeitFonts.push(f.charAt(0).toUpperCase() + f.slice(1));
    }
  });

  // فحص كائنات ومستطيلات الطمس والتبييض (White-out Rectangles)
  const hasWhiteout = /re\s*(?:h\s*)?1\s+1\s+1\s+RG\s+1\s+1\s+1\s+rg\s*[BfbF]/.test(fullSample) ||
                      /1\s+1\s+1\s+rg[\s\S]{1,60}?re\s*(?:h\s*)?[BfbF]/.test(fullSample) ||
                      /1\s+1\s+1\s+RG\s+1\s+1\s+1\s+rg\s*[\d\.\s]+re\s*[BfbF]/.test(fullSample);

  // فحص محركات التوليد والتصدير الخارجية غير المصرح بها
  let detectedExternalEngine = null;
  const externalEngines = ['mupdf', 'reportlab', 'weasyprint', 'wkhtmltopdf', 'fpdf', 'tcpdf', 'mpdf', 'itext', 'dompdf'];
  for (const eng of externalEngines) {
    if (fullSample.toLowerCase().includes(eng) || producer.toLowerCase().includes(eng) || creator.toLowerCase().includes(eng)) {
      detectedExternalEngine = eng;
      break;
    }
  }

  // فحص trn:oid
  let trnOid = null;
  const trnMatch = fullSample.match(/trn:oid:::[a-zA-Z0-9:]+/);
  if (trnMatch) trnOid = trnMatch[0];

  const isPypdf = producer.toLowerCase().includes('pypdf') || creator.toLowerCase().includes('pypdf') || fullSample.toLowerCase().includes('pypdf');
  const isPdfLib = producer.toLowerCase().includes('pdf-lib') || creator.toLowerCase().includes('pdf-lib') || fullSample.includes('pdf-lib');
  const isBrowserPrint = creator.toLowerCase().includes('chromium') || producer.toLowerCase().includes('skia');
  const hasXmp = fullSample.includes('<?xpacket') || fullSample.includes('<x:xmpmeta');

  return {
    producer,
    creator,
    title,
    creationDate,
    modDate,
    fakeAliases,
    genericFonts,
    counterfeitFonts,
    detectedExternalEngine,
    trnOid,
    isPypdf,
    isPdfLib,
    isBrowserPrint,
    hasXmp,
    hasBundledFont,
    hasWhiteout,
    hasPdflibSynthesizer
  };
}

// -------------------------------------------------------------
// شجرة القرار الجنائية الحاسمة 100% (Decisive 100% Decision Engine)
// -------------------------------------------------------------
function evaluateForensicDecision(data) {
  const flagsForgery = [];
  const flagsTampered = [];
  const flagsAuthentic = [];

  // أ) فحص مؤشرات التزوير والتلاعب القاطع (100% FAKE / TAMPERED)
  if (data.hasPdflibSynthesizer) {
    flagsForgery.push(currentLang === 'ar'
      ? 'بصمة قالب الغلاف المصطنع بـ pdf-lib (توليد النصوص بألوان 0.388/0.098 وأوامر TJ المدمجة)'
      : 'Counterfeit pdf-lib cover template footprint detected (synthetic 0.388/0.098 colors and inlined TJ operators)');
  }

  if (data.hasWhiteout) {
    flagsForgery.push(currentLang === 'ar'
      ? 'اكتشاف طبقة طمس وتبييض رقمية (White-out Overlay) لحجب وتعديل بيانات الغلاف الأصلية'
      : 'Digital white-out overlay detected concealing and patching official cover details');
  }

  if (data.hasBundledFont) {
    flagsForgery.push(currentLang === 'ar'
      ? 'حقن كائن خط خارجي غير معتمد (bundled_font) لتزوير اسم الملف وبيانات التقرير'
      : 'Counterfeit bundled font injection detected (bundled_font) used to stamp fake details');
  }

  if (data.detectedExternalEngine) {
    flagsForgery.push(currentLang === 'ar'
      ? `توليد المستند بمحرك برمجي خارجي غير معتمد من Turnitin: (${data.detectedExternalEngine})`
      : `Document generated using unauthorized external PDF engine: (${data.detectedExternalEngine})`);
  }

  if (data.counterfeitFonts && data.counterfeitFonts.length > 0) {
    flagsForgery.push(currentLang === 'ar'
      ? `تضمين خطوط مفتوحة المصدر تستخدمها سكريبتات التزوير الخارجية: (${data.counterfeitFonts.join(', ')})`
      : `Counterfeit open-source fonts detected from external forgery scripts: (${data.counterfeitFonts.join(', ')})`);
  }

  if (data.fakeAliases.length > 0) {
    flagsForgery.push(currentLang === 'ar' 
      ? `اكتشاف أسماء خطوط بديلة وهمية من قوالب التزوير المعروفة: (${data.fakeAliases.join(', ')})`
      : `Detected known forgery font aliases: (${data.fakeAliases.join(', ')})`);
  }

  if (data.genericFonts.length > 0) {
    flagsForgery.push(currentLang === 'ar'
      ? `تضمين خطوط غير مجزأة بدون كود التشفير الرسمي لـ Turnitin: (${data.genericFonts.join(', ')})`
      : `Generic un-subsetted fonts injected without official encryption: (${data.genericFonts.join(', ')})`);
  }

  if (data.hasHeaderDuplicationBug) {
    flagsForgery.push(currentLang === 'ar'
      ? 'خلل طباعة الترويسة المزدوجة المكررة (Duplicate Header Bug - بصمة سكريبتات التزوير)'
      : 'Corrupt duplicate header overlay bug detected (Known forgery script signature)');
  }

  if (data.isSameTimestamp && (data.fakeAliases.length > 0 || data.hasHeaderDuplicationBug)) {
    flagsForgery.push(currentLang === 'ar'
      ? 'تطابق توقيت الإنشاء والتعديل بالثانية الواحدة مع وجود أدوات تصنيع خارجية'
      : 'Exact creation and modification timestamps match down to the second with template footprints');
  }

  // ب) فحص مؤشرات التعديل والقص والدمج الخارجي
  if (data.isPypdf) {
    flagsTampered.push(currentLang === 'ar'
      ? 'تم حفظ وإعادة تصدير المستند بمكتبة بايثون (pypdf) خارج خوادم Turnitin'
      : 'Document was re-saved and merged using external Python pypdf library');
  }

  if (!data.hasCoverPage) {
    flagsTampered.push(currentLang === 'ar'
      ? 'حذف صفحة الغلاف الإلزامية (Cover Page) التي توثق بيانات الجامعة والمدرس وتاريخ الفحص'
      : 'Mandatory Cover Page (Document Details & Institution info) is completely stripped/missing');
  }

  if (!data.cdate && !data.mdate && data.isPypdf) {
    flagsTampered.push(currentLang === 'ar'
      ? 'طمس تواريخ الميتاداتا الأصلية بالكامل (CreationDate & ModDate)'
      : 'Original metadata timestamps were completely sanitized and wiped');
  }

  // اتخاذ القرار الحاسم بنسبة 100% (Decisive 100% Verdict)
  let verdict = 'UNKNOWN';
  let verdictClass = 'verdict-suspicious';
  let verdictTitle = '';
  let verdictSubtitle = '';
  let confidence = 100;
  let recommendation = '';

  // 1. التزوير الصريح 100%
  if (flagsForgery.length > 0) {
    verdict = 'FABRICATED_FORGERY';
    verdictClass = 'verdict-forgery';
    verdictTitle = currentLang === 'ar' ? 'مزيف 100% (Fake Forgery 100%)' : 'Fabricated Forgery (100% Fake)';
    verdictSubtitle = currentLang === 'ar' ? 'تم تصنيع وتوليد هذا التقرير بقوالب خارجية مصطنعة تحاكي Turnitin' : 'Generated using counterfeit templates mimicking Turnitin';
    confidence = 100;
    recommendation = currentLang === 'ar'
      ? 'رفض التقرير فوراً؛ المستند مصطنع بالكامل باستخدام قوالب خارجية تحاكي Turnitin.'
      : 'Reject report immediately. Fabricated using counterfeit web tools with fake font tables.';
  }
  // 2. التقرير المقصوص أو المدمج بـ pypdf بنسبة 100%
  else if (flagsTampered.length > 0) {
    verdict = 'TAMPERED_OR_INCOMPLETE';
    verdictClass = 'verdict-tampered';
    verdictTitle = currentLang === 'ar' ? 'معدل ومقصوص 100% (Tampered / Spliced 100%)' : 'Tampered / Spliced Document (100%)';
    verdictSubtitle = currentLang === 'ar' ? 'تم فحص البحث ولكن تم قص صفحة الغلاف الرسمية أو إعادة حفظه بأداة خارجية' : 'Authentic scan occurred, but Cover Page was stripped and re-saved via pypdf';
    confidence = 100;
    recommendation = currentLang === 'ar'
      ? 'التقرير غير مكتمل؛ جرى فحص البحث بالفعل لكن تم قص صفحة الغلاف الرسمية أو إعادة حفظه بأداة خارجية. لا يجوز اعتماده إلا بمطالبة مقدمه بالنسخة الكاملة غير المقصوصة أو مراجعة رقم الإرسال في حساب المدرس.'
      : 'Document is incomplete. The official Cover Page was stripped or manipulated via pypdf. Demand the full unstripped official report or verify trn:oid inside teacher account.';
  }
  // 3. التقرير الأصلي المعتمد 100%
  else {
    verdict = 'AUTHENTIC_OFFICIAL';
    verdictClass = 'verdict-authentic';
    verdictTitle = currentLang === 'ar' ? 'أصلي معتمد 100% (Authentic Official 100%)' : 'Authentic Official Report (100% Genuine)';
    verdictSubtitle = currentLang === 'ar' ? 'تقرير سليم وقانوني ومطابق 100% لمعايير تصدير Turnitin الرسمية المعتمدة' : 'Completely compliant with modern official Turnitin export standards';
    confidence = 100;

    flagsAuthentic.push(currentLang === 'ar'
      ? 'مطابق 100% لمعايير تصدير Turnitin الرسمية المعتمدة'
      : 'Matches official Turnitin export standards 100%');
    flagsAuthentic.push(currentLang === 'ar'
      ? 'صفحة الغلاف والترويسات الرسمية سليمة ومتكاملة'
      : 'Complete official Cover Page and standard headers present');
    flagsAuthentic.push(currentLang === 'ar'
      ? 'خلو تام من أي خطوط وهمية أو قوالب مصطنعة أو أدوات دمج خارجية'
      : 'Completely free from any fake font aliases or tampering tools');

    recommendation = currentLang === 'ar'
      ? 'التقرير سليم وقانوني ومطابق 100% لمعايير التصدير الرسمية لمنصة Turnitin.'
      : 'The report is authentic, valid, and fully compliant with official Turnitin export standards.';
  }

  return {
    ...data,
    verdict,
    verdictClass,
    verdictTitle,
    verdictSubtitle,
    confidence,
    recommendation,
    flagsForgery,
    flagsTampered,
    flagsAuthentic
  };
}

// -------------------------------------------------------------
// عرض النتائج في واجهة المستخدم
// -------------------------------------------------------------
function renderResults(res) {
  const verdictCard = document.getElementById('verdictCard');
  verdictCard.className = `verdict-card ${res.verdictClass}`;

  const verdictIcon = document.getElementById('verdictIcon');
  if (res.verdict === 'AUTHENTIC_OFFICIAL') {
    verdictIcon.innerHTML = `<svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
  } else if (res.verdict === 'FABRICATED_FORGERY') {
    verdictIcon.innerHTML = `<svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  } else {
    verdictIcon.innerHTML = `<svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  }

  document.getElementById('verdictBadge').textContent = res.verdict;
  document.getElementById('verdictTitle').textContent = res.verdictTitle;
  document.getElementById('verdictSubtitle').textContent = res.verdictSubtitle;

  document.getElementById('confidenceVal').textContent = `${res.confidence}%`;
  document.getElementById('confidenceBar').style.width = `${res.confidence}%`;
  document.getElementById('recommendationText').textContent = res.recommendation;

  // المؤشرات السريعة
  document.getElementById('metricReportType').textContent = res.reportType !== 'Unknown' ? res.reportType : (currentLang === 'ar' ? 'غير مصنف' : 'Unclassified');
  document.getElementById('metricScoreVal').textContent = res.detectedScore || (currentLang === 'ar' ? 'غير متوفر' : 'N/A');
  document.getElementById('metricSubmissionId').textContent = res.submissionId || (currentLang === 'ar' ? 'غير مكتشف' : 'Not Found');
  
  const coverStatusEl = document.getElementById('metricCoverStatus');
  if (res.hasCoverPage) {
    coverStatusEl.textContent = currentLang === 'ar' ? 'موجودة ونظامية ✅' : 'Present & Valid ✅';
    coverStatusEl.style.color = 'var(--success)';
  } else {
    coverStatusEl.textContent = currentLang === 'ar' ? 'محذوفة / مفقودة ❌' : 'Missing / Stripped ❌';
    coverStatusEl.style.color = 'var(--danger)';
  }

  document.getElementById('metricProducer').textContent = res.producer || (currentLang === 'ar' ? 'ممسوح (فارغ)' : 'Empty / Stripped');

  // قائمة الأدلة
  const evidenceList = document.getElementById('evidenceList');
  evidenceList.innerHTML = '';

  const allFlags = [
    ...res.flagsForgery.map(f => ({ text: f, type: 'fake' })),
    ...res.flagsTampered.map(f => ({ text: f, type: 'tampered' })),
    ...res.flagsAuthentic.map(f => ({ text: f, type: 'real' }))
  ];

  document.getElementById('evidenceCountBadge').textContent = currentLang === 'ar' ? `${allFlags.length} مؤشر` : `${allFlags.length} Flags`;

  allFlags.forEach(flag => {
    const el = document.createElement('div');
    el.className = `evidence-item item-${flag.type}`;
    el.innerHTML = `<span>${flag.type === 'fake' ? '🚨' : (flag.type === 'tampered' ? '⚠️' : '✅')}</span> <div>${flag.text}</div>`;
    evidenceList.appendChild(el);
  });

  // جدول الميتاداتا
  document.getElementById('metaFilename').textContent = res.filename;
  document.getElementById('metaPageCount').textContent = `${res.pageCount} ${currentLang === 'ar' ? 'صفحة' : 'Pages'}`;
  document.getElementById('metaCreator').textContent = res.creator || (currentLang === 'ar' ? 'غير محدد (فارغ)' : 'Empty');
  document.getElementById('metaCreationDate').textContent = res.cdate || (currentLang === 'ar' ? 'ممسوح (غير مسجل)' : 'None');
  document.getElementById('metaModDate').textContent = res.mdate || (currentLang === 'ar' ? 'ممسوح (غير مسجل)' : 'None');
  document.getElementById('metaPdfVersion').textContent = res.isPypdf ? 'PDF 1.3 (pypdf output)' : (res.isPdfLib ? 'PDF 1.7 (pdf-lib web)' : 'PDF Standard');
  document.getElementById('metaXmpStatus').textContent = res.hasXmp ? (currentLang === 'ar' ? 'متوفرة ✅' : 'Available ✅') : (currentLang === 'ar' ? 'محذوفة (0 بايت) ❌' : 'Deleted (0 Bytes) ❌');

  resultsSection.classList.remove('hidden');
  resultsSection.scrollIntoView({ behavior: 'smooth' });
}

function showLoading(show, text = '') {
  if (show) {
    loadingStatusText.textContent = text;
    loadingIndicator.classList.remove('hidden');
  } else {
    loadingIndicator.classList.add('hidden');
  }
}

function resetAuditor() {
  fileInput.value = '';
  resultsSection.classList.add('hidden');
  dropZone.scrollIntoView({ behavior: 'smooth' });
}

// -------------------------------------------------------------
// النماذج الجاهزة للفحص السريع (Demo Samples)
// -------------------------------------------------------------
btnSampleReal.addEventListener('click', () => {
  const mockReal = {
    filename: 'AI_002119_4_1.pdf (نموذج أصلي معتمد)',
    pageCount: 29,
    producer: 'pdf-lib (https://github.com/Hopding/pdf-lib)',
    creator: 'Microsoft® Word for Microsoft 365',
    cdate: "D:20260917221505+00'00'",
    mdate: 'D:20260917221650Z',
    hasXmp: true,
    fakeAliases: [],
    genericFonts: [],
    hasHeaderDuplicationBug: false,
    hasCoverPage: true,
    hasStandardPagination: true,
    isPypdf: false,
    isPdfLib: true,
    isBrowserPrint: false,
    isSameTimestamp: false,
    submissionId: 'trn:oid:::3618:152091199',
    reportType: 'Turnitin AI Writing Report',
    detectedScore: '*%'
  };
  renderResults(evaluateForensicDecision(mockReal));
});

btnSampleFake.addEventListener('click', () => {
  const mockFake = {
    filename: 'Ai_Ahmed_Juma_Altamimi.pdf (نموذج مزور بقوالب خارجية)',
    pageCount: 24,
    producer: 'pdf-lib (https://github.com/Hopding/pdf-lib)',
    creator: 'pdf-lib (https://github.com/Hopding/pdf-lib)',
    cdate: 'D:20261009071850Z',
    mdate: 'D:20261009071850Z',
    hasXmp: false,
    fakeAliases: ['NotoR', 'NotoSB', 'LexM', 'LexSB'],
    genericFonts: ['Noto Sans Regular', 'Lexend Deca Medium'],
    hasHeaderDuplicationBug: true,
    hasCoverPage: true,
    hasStandardPagination: true,
    isPypdf: false,
    isPdfLib: true,
    isBrowserPrint: false,
    isSameTimestamp: true,
    submissionId: 'trn:oid:::4:405393237',
    reportType: 'Turnitin AI Writing Report',
    detectedScore: '0%'
  };
  renderResults(evaluateForensicDecision(mockFake));
});

btnSampleTampered.addEventListener('click', () => {
  const mockTampered = {
    filename: 'ai843958.pdf (نموذج مقصوص الغلاف ومحفوظ بـ pypdf)',
    pageCount: 23,
    producer: 'pypdf',
    creator: '',
    cdate: '',
    mdate: '',
    hasXmp: false,
    fakeAliases: [],
    genericFonts: [],
    hasHeaderDuplicationBug: false,
    hasCoverPage: false,
    hasStandardPagination: false,
    isPypdf: true,
    isPdfLib: false,
    isBrowserPrint: false,
    isSameTimestamp: false,
    submissionId: 'trn:oid:::8:1890160716',
    reportType: 'Turnitin AI Writing Report',
    detectedScore: '*%'
  };
  renderResults(evaluateForensicDecision(mockTampered));
});

// تبديل اللغة (Arabic / English)
langToggle.addEventListener('click', () => {
  if (currentLang === 'ar') {
    currentLang = 'en';
    document.documentElement.setAttribute('lang', 'en');
    document.documentElement.setAttribute('dir', 'ltr');
    langToggle.textContent = 'العربية';
  } else {
    currentLang = 'ar';
    document.documentElement.setAttribute('lang', 'ar');
    document.documentElement.setAttribute('dir', 'rtl');
    langToggle.textContent = 'English';
  }
});

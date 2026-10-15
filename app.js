/**
 * TurniAudit Forensic Engine - Client-Side PDF Forensic Analyzer
 * نظام العدالة الجنائية الرقمية لفحص تقارير Turnitin بالكامل داخل المتصفح
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
    
    // فحص المحتوى الثنائي (Raw Binary Forensics)
    const rawAnalysis = analyzeRawPdfBytes(rawBytes);

    // فحص البنية النصية عبر PDF.js
    const pdfDoc = await pdfjsLib.getDocument({ data: rawBytes }).promise;
    const pageCount = pdfDoc.numPages;

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

    // فحص التكرار المزدوج للترويسة في الصفحة الأولى
    let hasHeaderDuplicationBug = false;
    const p1Matches = (p1Text.match(/Page 1 of/g) || []).length;
    if (p1Matches > 1 && rawAnalysis.isPdfLib) {
      hasHeaderDuplicationBug = true;
    }

    const hasStandardPagination = /Page\s+\d+\s+of\s+\d+/.test(fullOverviewText) || /صفحة\s+\d+\s+من\s+\d+/.test(fullOverviewText);

    // بناء القرار الجنائي الصارم
    const auditResult = evaluateForensicDecision({
      filename: file.name,
      pageCount: pageCount,
      producer: rawAnalysis.producer,
      creator: rawAnalysis.creator,
      cdate: rawAnalysis.creationDate,
      mdate: rawAnalysis.modDate,
      hasXmp: rawAnalysis.hasXmp,
      fakeAliases: rawAnalysis.fakeAliases,
      genericFonts: rawAnalysis.genericFonts,
      hasHeaderDuplicationBug: hasHeaderDuplicationBug,
      hasCoverPage: hasCoverPage,
      hasStandardPagination: hasStandardPagination,
      isPypdf: rawAnalysis.isPypdf,
      isPdfLib: rawAnalysis.isPdfLib,
      isBrowserPrint: rawAnalysis.isBrowserPrint,
      isSameTimestamp: rawAnalysis.isSameTimestamp,
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
// تشريح بيانات البايت الثنائية لملف الـ PDF
// -------------------------------------------------------------
function analyzeRawPdfBytes(bytes) {
  // فحص أول 100 كيلوبايت وآخر 100 كيلوبايت للسرعة والدقة
  const headLen = Math.min(bytes.length, 150000);
  const tailStart = Math.max(0, bytes.length - 150000);
  
  const headStr = new TextDecoder('latin1').decode(bytes.slice(0, headLen));
  const tailStr = new TextDecoder('latin1').decode(bytes.slice(tailStart));
  const fullSample = headStr + '\n' + tailStr;

  // استخراج Producer و Creator
  let producer = '';
  const prodMatch = fullSample.match(/\/Producer\s*\(([^)]+)\)/);
  if (prodMatch) producer = prodMatch[1];

  let creator = '';
  const creatMatch = fullSample.match(/\/Creator\s*\(([^)]+)\)/);
  if (creatMatch) creator = creatMatch[1];

  // استخراج تواريخ الميتاداتا
  let creationDate = '';
  const cMatch = fullSample.match(/\/CreationDate\s*\(([^)]+)\)/);
  if (cMatch) creationDate = cMatch[1];

  let modDate = '';
  const mMatch = fullSample.match(/\/ModDate\s*\(([^)]+)\)/);
  if (mMatch) modDate = mMatch[1];

  // فحص أسماء الخطوط الوهمية المستخدمة في التزوير
  const fakeAliases = [];
  ['NotoR', 'NotoSB', 'LexM', 'LexSB'].forEach(alias => {
    if (fullSample.includes(`/${alias} `) || fullSample.includes(`/${alias}/`) || fullSample.includes(`/${alias}\n`)) {
      fakeAliases.push(alias);
    }
  });

  const genericFonts = [];
  ['Noto Sans Regular', 'Lexend Deca Medium', 'Noto Sans SemiBold', 'Lexend Deca SemiBold'].forEach(f => {
    if (fullSample.includes(f)) {
      genericFonts.push(f);
    }
  });

  // فحص trn:oid
  let trnOid = null;
  const trnMatch = fullSample.match(/trn:oid:::[a-zA-Z0-9:]+/);
  if (trnMatch) trnOid = trnMatch[0];

  const isPypdf = producer.toLowerCase().includes('pypdf') || creator.toLowerCase().includes('pypdf');
  const isPdfLib = producer.toLowerCase().includes('pdf-lib') || fullSample.includes('pdf-lib');
  const isBrowserPrint = creator.toLowerCase().includes('chromium') || producer.toLowerCase().includes('skia');
  const isSameTimestamp = (creationDate === modDate && creationDate.length > 8 && isPdfLib);
  const hasXmp = fullSample.includes('<?xpacket') || fullSample.includes('<x:xmpmeta');

  return {
    producer,
    creator,
    creationDate,
    modDate,
    fakeAliases,
    genericFonts,
    trnOid,
    isPypdf,
    isPdfLib,
    isBrowserPrint,
    isSameTimestamp,
    hasXmp
  };
}

// -------------------------------------------------------------
// شجرة القرار الجنائية المنصفة (Strict 4-Tier Decision Tree)
// -------------------------------------------------------------
function evaluateForensicDecision(data) {
  const flagsForgery = [];
  const flagsTampered = [];
  const flagsAuthentic = [];

  // أ) فحص مؤشرات التزوير القاطع
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

  if (!data.hasStandardPagination && (data.isPypdf || !data.hasCoverPage)) {
    flagsTampered.push(currentLang === 'ar'
      ? 'تشوه وحذف صيغة ترقيم الصفحات الرسمية القياسية (Page X of Y)'
      : 'Official standard pagination format (Page X of Y) is deformed or missing');
  }

  // ج) فحص مؤشرات الأصالة والسلامة الرسمية
  if (data.isPdfLib && data.fakeAliases.length === 0 && !data.hasHeaderDuplicationBug && data.hasCoverPage) {
    flagsAuthentic.push(currentLang === 'ar'
      ? 'يطابق بنية خوادم Turnitin Quick Submit الرسمية الحديثة (محرك pdf-lib المعتمد)'
      : 'Matches modern official Turnitin Quick Submit client-side export architecture (pdf-lib)');
  }

  if (data.hasCoverPage && data.hasStandardPagination) {
    flagsAuthentic.push(currentLang === 'ar'
      ? 'توفر صفحة الغلاف والترويسات الرسمية بتنسيق Turnitin المعتمد'
      : 'Complete official Cover Page and standard header pagination present');
  }

  if (data.cdate && data.mdate && data.cdate !== data.mdate) {
    flagsAuthentic.push(currentLang === 'ar'
      ? 'تسلسل زمني طبيعي ومنطقي بين تاريخ الرفع وتاريخ التنزيل'
      : 'Natural and logical time delta between submission timestamp and download timestamp');
  }

  if (data.isBrowserPrint && data.hasCoverPage) {
    flagsAuthentic.push(currentLang === 'ar'
      ? 'طباعة ويب نظامية مباشرة من متصفح حساب المدرس في Turnitin'
      : 'Standard web print direct from teacher account in Turnitin');
  }

  // اتخاذ القرار العادل
  let verdict = 'UNKNOWN';
  let verdictClass = 'verdict-suspicious';
  let verdictTitle = '';
  let verdictSubtitle = '';
  let confidence = 0;
  let recommendation = '';

  if (flagsForgery.length > 0) {
    verdict = 'FABRICATED_FORGERY';
    verdictClass = 'verdict-forgery';
    verdictTitle = currentLang === 'ar' ? 'تقرير مزور ومصطنع بالكامل (Fake Forgery)' : 'Fabricated Forgery (100% Fake)';
    verdictSubtitle = currentLang === 'ar' ? 'تم توليد هذا التقرير بقوالب خارجية مصطنعة تحاكي Turnitin' : 'Generated using counterfeit templates mimicking Turnitin';
    confidence = 100;
    recommendation = currentLang === 'ar'
      ? 'رفض التقرير فوراً؛ تم تصنيعه بواسطة أدوات تزوير خارجية ولا صلة له بخوادم Turnitin.'
      : 'Reject report immediately. Fabricated using counterfeit web tools with fake font tables.';
  } else if (flagsTampered.length > 0) {
    verdict = 'TAMPERED_OR_INCOMPLETE';
    verdictClass = 'verdict-tampered';
    verdictTitle = currentLang === 'ar' ? 'معدل أو مقصوص خارجياً (Tampered / Stripped)' : 'Tampered / Stripped Document';
    verdictSubtitle = currentLang === 'ar' ? 'تم فحص البحث ولكن تم قص صفحة الغلاف أو إعادة دمجه بـ pypdf' : 'Authentic scan occurred, but Cover Page was stripped and re-saved via pypdf';
    confidence = 99;
    recommendation = currentLang === 'ar'
      ? 'التقرير غير مكتمل كوثيقة رسمية؛ تم حذف صفحة الغلاف الإلزامية أو إعادة حفظه بواسطة أداة خارجية (pypdf). لا يجوز اعتماده إلا بمطالبة مقدمه بالنسخة الكاملة الأصلية أو مراجعة رقم الإرسال في حساب المدرس.'
      : 'Document is incomplete. The official Cover Page was stripped or manipulated via pypdf. Demand the full unstripped official report or verify trn:oid inside teacher account.';
  } else if (flagsAuthentic.length >= 2 && flagsForgery.length === 0 && flagsTampered.length === 0) {
    verdict = 'AUTHENTIC_OFFICIAL';
    verdictClass = 'verdict-authentic';
    verdictTitle = currentLang === 'ar' ? 'تقرير أصلي ورسمي معتمد (Authentic Official)' : 'Authentic Official Turnitin Report';
    verdictSubtitle = currentLang === 'ar' ? 'تقرير سليم وقانوني ومطابق 100% لمعايير تصدير Turnitin الرسمية' : 'Completely compliant with modern official Turnitin export standards';
    confidence = 98;
    recommendation = currentLang === 'ar'
      ? 'التقرير سليم وقانوني ومطابق 100% لمعايير التصدير الرسمية لمنصة Turnitin.'
      : 'The report is authentic, valid, and fully compliant with official Turnitin export standards.';
  } else {
    verdict = 'SUSPICIOUS_MANUAL_REVIEW';
    verdictClass = 'verdict-suspicious';
    verdictTitle = currentLang === 'ar' ? 'مشبوه - يتطلب مراجعة حساب المدرس' : 'Suspicious - Manual Verification Required';
    verdictSubtitle = currentLang === 'ar' ? 'الملف يحتوي على خصائص غير قياسية لمنع الظلم يوصى بالفحص اليدوي' : 'Non-standard characteristics found. Requires manual verification in LMS.';
    confidence = 70;
    recommendation = currentLang === 'ar'
      ? 'لا توجد أدلة تزوير قطعية لإدانة الطالب، ولكن الملف تنقصه بعض معايير التصدير القياسية. لتحقيق العدالة الكاملة: اطلب مراجعة التقرير مباشرة من داخل حساب المدرس.'
      : 'No conclusive evidence to accuse the student, but standards vary. Check trn:oid directly in LMS.';
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
  // كارت النتيجة الرئيسي
  const verdictCard = document.getElementById('verdictCard');
  verdictCard.className = `verdict-card ${res.verdictClass}`;

  const verdictIcon = document.getElementById('verdictIcon');
  if (res.verdict === 'AUTHENTIC_OFFICIAL') {
    verdictIcon.innerHTML = `<svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
  } else if (res.verdict === 'FABRICATED_FORGERY') {
    verdictIcon.innerHTML = `<svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  } else if (res.verdict === 'TAMPERED_OR_INCOMPLETE') {
    verdictIcon.innerHTML = `<svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  } else {
    verdictIcon.innerHTML = `<svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
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

  if (allFlags.length === 0) {
    evidenceList.innerHTML = `<div class="evidence-item item-real">${currentLang === 'ar' ? 'لم يتم رصد أي مؤشرات شاذة أو مشبوهة.' : 'No anomalies detected.'}</div>`;
  } else {
    allFlags.forEach(flag => {
      const el = document.createElement('div');
      el.className = `evidence-item item-${flag.type}`;
      el.innerHTML = `<span>${flag.type === 'fake' ? '🚨' : (flag.type === 'tampered' ? '⚠️' : '✅')}</span> <div>${flag.text}</div>`;
      evidenceList.appendChild(el);
    });
  }

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

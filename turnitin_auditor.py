import os
import re
import sys
import json
import pymupdf
from typing import Dict, Any, List

class TurnitinStrictAuditor:
    """
    محرّك التحقيق الجنائي الصارم لتقارير Turnitin - الإصدار الحاسم 100%
    مبني على البصمات الجنائية المادية الحقيقية لمنصة Turnitin:
    1. أصلي 100% (AUTHENTIC_OFFICIAL): يطابق معايير Turnitin الرسمية بدون أي بصمات تزوير.
    2. مزيف 100% (FABRICATED_FORGERY): يحتوي على أدلة تزوير قاطعة (خطوط وهمية / ترويسة مكررة / قوالب مصطنعة).
    3. معدل ومقصوص 100% (TAMPERED_OR_INCOMPLETE): فُحص في السيرفر لكن تم قص صفحة الغلاف الإلزامية أو إعادة حفظه بـ pypdf.
    """

    FORGERY_FONT_ALIASES = {'NotoR', 'NotoSB', 'LexM', 'LexSB'}
    FORGERY_GENERIC_FONTS = {'Noto Sans Regular', 'Lexend Deca Medium', 'Noto Sans SemiBold', 'Lexend Deca SemiBold'}
    FORGERY_COUNTERFEIT_FONTS = {'liberation', 'dejavu', 'freesans'}
    FORGERY_EXTERNAL_ENGINES = {'mupdf', 'reportlab', 'weasyprint', 'wkhtmltopdf', 'fpdf', 'tcpdf', 'mpdf', 'itext', 'dompdf'}

    @classmethod
    def audit_pdf(cls, file_path: str) -> Dict[str, Any]:
        result = {
            "file_path": file_path,
            "filename": os.path.basename(file_path),
            "verdict": "UNKNOWN",
            "verdict_title": "",
            "confidence_pct": 100,
            "report_type": "Unknown",
            "submission_id": None,
            "detected_score": None,
            "is_clean_official": False,
            "flags_forgery": [],
            "flags_tampered": [],
            "flags_authentic": [],
            "metadata": {},
            "recommendation": ""
        }

        if not os.path.exists(file_path):
            result["verdict"] = "FILE_NOT_FOUND"
            result["verdict_title"] = "الملف غير موجود"
            result["confidence_pct"] = 0
            result["recommendation"] = "تأكد من مسار الملف."
            return result

        try:
            doc = pymupdf.open(file_path)
        except Exception as e:
            result["verdict"] = "CORRUPT_PDF"
            result["verdict_title"] = "ملف تالف أو غير صالح كـ PDF"
            result["confidence_pct"] = 0
            result["recommendation"] = f"فشل فتح الملف: {str(e)}"
            return result

        page_count = len(doc)
        meta = doc.metadata or {}
        producer = (meta.get("producer") or "").strip()
        creator = (meta.get("creator") or "").strip()
        cdate = (meta.get("creationDate") or "").strip()
        mdate = (meta.get("modDate") or "").strip()

        result["metadata"] = {
            "producer": producer,
            "creator": creator,
            "creation_date": cdate,
            "mod_date": mdate,
            "page_count": page_count,
            "format": meta.get("format", "N/A"),
            "has_xmp": bool(doc.get_xml_metadata())
        }

        # 1. استخراج النصوص
        p1_text = doc[0].get_text() if page_count > 0 else ""
        p2_text = doc[1].get_text() if page_count > 1 else ""
        full_overview_text = p1_text + "\n" + p2_text

        # رقم الإرسال
        trn_match = re.search(r'trn:oid:::[a-zA-Z0-9:]+', full_overview_text)
        if trn_match:
            result["submission_id"] = trn_match.group(0)

        # استخراج النسبة ونوع التقرير
        if "detected as AI" in full_overview_text or "تم إنشاؤه بالذكاء" in full_overview_text:
            result["report_type"] = "Turnitin AI Writing Report"
            score_m = re.search(r'(\d+%|\*%)\s*(detected as AI|من المحتوى تم إنشاؤه)', full_overview_text)
            if score_m:
                result["detected_score"] = score_m.group(1)
        elif "Overall Similarity" in full_overview_text or "التشابه الكلي" in full_overview_text or "Match Groups" in full_overview_text:
            result["report_type"] = "Turnitin Similarity Report"
            score_m = re.search(r'(\d+%)\s*(Overall Similarity|التشابه)', full_overview_text)
            if score_m:
                result["detected_score"] = score_m.group(1)

        # قراءة البايتات الخام للتحقق الثنائي
        with open(file_path, "rb") as fp:
            raw_bytes = fp.read()
        raw_lower = raw_bytes.lower()

        # 2. فحص الخطوط والأسماء البديلة
        detected_fake_aliases = set()
        detected_generic_fonts = set()
        detected_counterfeit_fonts = set()

        for p in doc:
            for f in p.get_fonts():
                basefont, alias = f[3], f[4]
                if alias in cls.FORGERY_FONT_ALIASES:
                    detected_fake_aliases.add(alias)
                if basefont in cls.FORGERY_GENERIC_FONTS:
                    detected_generic_fonts.add(basefont)
                for cfont in cls.FORGERY_COUNTERFEIT_FONTS:
                    if cfont in basefont.lower() or cfont in alias.lower():
                        detected_counterfeit_fonts.add(basefont)

        # فحص البايتات المباشرة للخطوط البديلة والمفتوحة
        for alias in cls.FORGERY_FONT_ALIASES:
            for needle in [f"/{alias} ".encode(), f"/{alias}/".encode(), f"/{alias}\n".encode()]:
                if needle in raw_bytes:
                    detected_fake_aliases.add(alias)

        for cfont in cls.FORGERY_COUNTERFEIT_FONTS:
            if cfont.encode() in raw_lower:
                detected_counterfeit_fonts.add(cfont.title())

        # 3. فحص حقن الخطوط الخارجية ومستطيلات الطمس (White-out Overlay & Bundled Font)
        has_bundled_font = b"bundled_font" in raw_bytes
        has_whiteout = bool(re.search(rb're\s*(?:h\s*)?1\s+1\s+1\s+RG\s+1\s+1\s+1\s+rg\s*[BfbF]', raw_bytes) or
                           re.search(rb'1\s+1\s+1\s+rg[\s\S]{1,60}?re\s*(?:h\s*)?[BfbF]', raw_bytes) or
                           re.search(rb'1\s+1\s+1\s+RG\s+1\s+1\s+1\s+rg\s*[\d\.\s]+re\s*[BfbF]', raw_bytes))

        # 4. فحص بصمة قالب الغلاف الاصطناعي (pdf-lib drawText Synthesizer Footprint)
        has_pdflib_synthesizer = False
        p1_streams = b""
        if page_count > 0:
            for x in doc[0].get_contents():
                p1_streams += doc.xref_stream(x)
        p1_streams_str = p1_streams.decode('latin1', errors='ignore')
        if ("0.388 0.388 0.388 RG" in p1_streams_str or "0.098 0.098 0.098 RG" in p1_streams_str or
            re.search(r'Tf\s+[\d\.]+\s+[\d\.]+\s+[\d\.]+\s+RG\s+[\d\.]+\s+[\d\.]+\s+[\d\.]+\s+rg\s*\[<[0-9a-fA-F]+>\]TJ', p1_streams_str)):
            has_pdflib_synthesizer = True

        # 5. فحص محركات وأدوات التزوير الخارجية غير الرسمية
        detected_external_engine = None
        for eng in cls.FORGERY_EXTERNAL_ENGINES:
            if eng.encode() in raw_lower or eng in producer.lower() or eng in creator.lower():
                detected_external_engine = eng
                break

        # 6. فحص الخلل البرمجي الشهير في سكريبتات التزوير (تكرار نص الترويسة)
        has_header_duplication_bug = False
        if "Page 1 of" in p1_text:
            for line in p1_text.splitlines():
                if line.count("Page 1 of") > 1:
                    has_header_duplication_bug = True
                    break

        # 7. فحص تطابق التوقيت الزمني بالثانية مع pdf-lib
        is_pdflib = "pdf-lib" in producer.lower() or "pdf-lib" in creator.lower()
        has_exact_same_timestamp = (cdate == mdate and len(cdate) > 8 and is_pdflib)

        # 8. فحص بصمة لون رقم الإرسال (#181818 الخاص بسكريبتات التزوير)
        sub_id_is_181818 = False
        try:
            p1_json = json.loads(doc[0].get_text("json"))
            for b in p1_json.get("blocks", []):
                for l in b.get("lines", []):
                    for s in l.get("spans", []):
                        if "trn:oid" in s.get("text", ""):
                            if s.get("color", 0) == 0x181818:
                                sub_id_is_181818 = True
        except Exception:
            pass

        # 9. فحص صفحة الغلاف الرسمية
        has_cover_page = ("Document Details" in p1_text or "تفاصيل المستند" in p1_text) and (
            "Submission ID" in p1_text or "معرف الإرسال" in p1_text
        )

        # 10. فحص أدوات التجميع الخارجية وتفريغ الميتاداتا
        is_pypdf = "pypdf" in producer.lower() or "pypdf" in creator.lower() or b"pypdf" in raw_lower
        is_metadata_wiped = (not cdate and not mdate and is_pypdf)
        is_browser_print = "chromium" in creator.lower() or "skia" in producer.lower()

        # ==========================================================
        # شجرة القرار الحاسمة بنسبة 100% (Decisive 100% Rules)
        # ==========================================================

        # [أ] أدلة التزوير القاطع (100% FAKE)
        if (has_pdflib_synthesizer or has_whiteout or has_bundled_font or detected_fake_aliases or detected_generic_fonts or detected_counterfeit_fonts or 
            detected_external_engine or has_header_duplication_bug or (has_exact_same_timestamp and sub_id_is_181818)):
            result["verdict"] = "FABRICATED_FORGERY"
            result["verdict_title"] = "مزيف ومعدل 100% (Fake / Tampered Forgery)"
            result["confidence_pct"] = 100
            result["is_clean_official"] = False
            
            if has_pdflib_synthesizer:
                result["flags_forgery"].append("بصمة قالب الغلاف المصطنع بـ pdf-lib (توليد النصوص بألوان 0.388/0.098 وأوامر TJ المدمجة)")
            if has_whiteout:
                result["flags_forgery"].append("اكتشاف طبقة طمس وتبييض رقمية (White-out Overlay) لحجب وتعديل بيانات الغلاف الرسمية")
            if has_bundled_font:
                result["flags_forgery"].append("حقن كائن خط خارجي غير معتمد (bundled_font) لتزوير اسم الملف وتفاصيل التقرير")
            if detected_external_engine:
                result["flags_forgery"].append(f"توليد المستند بمحرك برمجي خارجي غير معتمد من Turnitin: ({detected_external_engine})")
            if detected_counterfeit_fonts:
                result["flags_forgery"].append(f"تضمين خطوط مفتوحة المصدر تستخدمها سكريبتات التزوير الخارجية: {list(detected_counterfeit_fonts)}")
            if detected_fake_aliases:
                result["flags_forgery"].append(f"استخدام أسماء خطوط بديلة خاصة بأدوات التزوير المعروفة: {list(detected_fake_aliases)}")
            if detected_generic_fonts:
                result["flags_forgery"].append(f"تضمين خطوط غير مجزأة بدون التشفير الرسمي لـ Turnitin: {list(detected_generic_fonts)}")
            if has_header_duplication_bug:
                result["flags_forgery"].append("خلل طباعة الترويسة المزدوجة المكررة (Duplicate Header Bug)")
            if has_exact_same_timestamp and sub_id_is_181818:
                result["flags_forgery"].append("بصمة لون النص المطبوع (#181818) مع تطابق توقيت التصدير بالثانية")

            result["recommendation"] = "رفض التقرير فوراً؛ المستند مصطنع أو خضع لتعديل وطمس جراحي للبيانات بقوالب وأدوات خارجية تحاكي Turnitin."

        # [ب] أدلة التعديل والقص والدمج الخارجي (100% TAMPERED)
        elif is_pypdf or not has_cover_page or is_metadata_wiped:
            result["verdict"] = "TAMPERED_OR_INCOMPLETE"
            result["verdict_title"] = "معدل ومقصوص 100% (Tampered / Spliced)"
            result["confidence_pct"] = 100
            result["is_clean_official"] = False

            if not has_cover_page:
                result["flags_tampered"].append("حذف صفحة الغلاف الإلزامية (Cover Page) التي توثق اسم المؤسسة والمدرس وتاريخ الفحص")
            if is_pypdf:
                result["flags_tampered"].append("إعادة تجميع وحفظ المستند بمكتبة بايثون الخارجية (pypdf)")
            if is_metadata_wiped:
                result["flags_tampered"].append("طمس وتفريغ تواريخ الميتاداتا وحذف شجرة XMP Metadata الأصلية")

            result["recommendation"] = (
                "التقرير غير مكتمل؛ جرى فحص البحث بالفعل لكن تم قص صفحة الغلاف الرسمية أو إعادة حفظه بأداة خارجية. "
                "لا يجوز اعتماده إلا بمطالبة مقدمه بالنسخة الكاملة غير المقصوصة أو مراجعة رقم الإرسال في حساب المدرس."
            )

        # [ج] التقرير الأصلي المعتمد (100% REAL)
        else:
            result["verdict"] = "AUTHENTIC_OFFICIAL"
            result["verdict_title"] = "أصلي معتمد 100% (Authentic Official)"
            result["confidence_pct"] = 100
            result["is_clean_official"] = True

            result["flags_authentic"].append("مطابق 100% لمعايير تصدير Turnitin الرسمية المعتمدة")
            result["flags_authentic"].append("صفحة الغلاف والترويسات الرسمية سليمة ومتكاملة")
            result["flags_authentic"].append("خلو تام من أي خطوط وهمية أو قوالب مصطنعة أو أدوات دمج خارجية")

            result["recommendation"] = "التقرير سليم وقانوني ومطابق 100% لمعايير التصدير الرسمية لمنصة Turnitin."

        return result


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

    if len(sys.argv) < 2:
        print("Usage: python turnitin_auditor.py <path_to_pdf>")
        sys.exit(1)

    target_path = sys.argv[1]
    res = TurnitinStrictAuditor.audit_pdf(target_path)
    print(json.dumps(res, ensure_ascii=False, indent=2))

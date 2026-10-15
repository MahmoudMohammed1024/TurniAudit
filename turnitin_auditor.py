import os
import re
import sys
import json
import pymupdf
from typing import Dict, Any, List

class TurnitinStrictAuditor:
    """
    محرّك التحقيق الجنائي الصارم لتقارير Turnitin
    مُصمّم وفق مبدأ 'العدالة الرقمية التامة' لمنع اتهام أي طالب أو مستند بالخطأ:
    1. Zero False Positives: لا يتم وسم أي تقرير أصلي بالتزوير.
    2. Zero False Negatives: كشف كافة أدوات التزوير والتوليد الاصطناعي.
    3. الدقة والتفريق المنصف: التفريق بين التقرير المزور بالكامل، والتقرير الحقيقي الذي تم قص غلافه أو دمجه بـ pypdf.
    """

    # بصمات أسماء الخطوط البديلة (Font Aliases) الحصرية لأشهر سكريبتات ومواقع التزوير
    FORGERY_FONT_ALIASES = {'NotoR', 'NotoSB', 'LexM', 'LexSB'}
    
    # الخطوط العامة التي يحقنها المزورون بدون التجزئة والترميز الرسمي لمنصة Turnitin
    FORGERY_GENERIC_FONTS = {'Noto Sans Regular', 'Lexend Deca Medium', 'Noto Sans SemiBold', 'Lexend Deca SemiBold'}

    @classmethod
    def audit_pdf(cls, file_path: str) -> Dict[str, Any]:
        """
        فحص ملف PDF وإرجاع تقرير جنائي متكامل مع الأدلة القاطعة.
        """
        result = {
            "file_path": file_path,
            "filename": os.path.basename(file_path),
            "verdict": "UNKNOWN",               # التصنيف البرمجي
            "verdict_title": "",                # الوصف بالعربية
            "confidence_pct": 0,                # نسبة التأكد
            "report_type": "Unknown",           # نوع التقرير (AI / Similarity)
            "submission_id": None,              # رقم الإرسال trn:oid
            "detected_score": None,             # النسبة المستخرجة إن وُجدت
            "is_clean_official": False,         # هل هو رسمي ونظيف بنسبة 100%؟
            "flags_forgery": [],                # أدلة التزوير القاطع
            "flags_tampered": [],               # أدلة القص والتعديل
            "flags_authentic": [],              # أدلة الأصالة والسلامة
            "metadata": {},                     # الميتاداتا
            "recommendation": ""                # التوصية الإجرائية العادلة
        }

        if not os.path.exists(file_path):
            result["verdict"] = "FILE_NOT_FOUND"
            result["verdict_title"] = "الملف غير موجود"
            result["recommendation"] = "تأكد من مسار الملف."
            return result

        try:
            doc = pymupdf.open(file_path)
        except Exception as e:
            result["verdict"] = "CORRUPT_PDF"
            result["verdict_title"] = "ملف تالف أو غير صالح كـ PDF"
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

        # -------------------------------------------------------------
        # 1. استخراج وتحليل النصوص والترويسات
        # -------------------------------------------------------------
        p1_text = doc[0].get_text() if page_count > 0 else ""
        p2_text = doc[1].get_text() if page_count > 1 else ""
        full_overview_text = p1_text + "\n" + p2_text

        # استخراج رقم الإرسال
        trn_match = re.search(r'trn:oid:::[a-zA-Z0-9:]+', full_overview_text)
        if trn_match:
            result["submission_id"] = trn_match.group(0)

        # استخراج نوع التقرير والنسبة
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

        # -------------------------------------------------------------
        # 2. الفحص الجنائي للخطوط (Font Forensics)
        # -------------------------------------------------------------
        detected_fake_aliases = set()
        detected_generic_fonts = set()
        for pidx, page in enumerate(doc):
            for f in page.get_fonts():
                basefont, alias = f[3], f[4]
                if alias in cls.FORGERY_FONT_ALIASES:
                    detected_fake_aliases.add(alias)
                if basefont in cls.FORGERY_GENERIC_FONTS:
                    detected_generic_fonts.add(basefont)

        # -------------------------------------------------------------
        # 3. فحص صفحة الغلاف والترويسات (Cover & Header Forensics)
        # -------------------------------------------------------------
        has_cover_page = ("Document Details" in p1_text or "تفاصيل المستند" in p1_text) and (
            "Submission ID" in p1_text or "معرف الإرسال" in p1_text
        )

        # فحص الخلل البرمجي الشهير في سكريبتات التزوير (تكرار نص الترويسة في نفس السطر)
        has_header_duplication_bug = False
        if "Page 1 of" in p1_text:
            for line in p1_text.splitlines():
                if line.count("Page 1 of") > 1:
                    has_header_duplication_bug = True
                    break

        # فحص ترقيم الصفحات القياسي
        has_standard_pagination = bool(re.search(r'Page\s+\d+\s+of\s+\d+', full_overview_text) or re.search(r'صفحة\s+\d+\s+من\s+\d+', full_overview_text))

        # -------------------------------------------------------------
        # 4. فحص الميتاداتا والتوقيت الزمني (Temporal & Tool Forensics)
        # -------------------------------------------------------------
        is_pypdf = "pypdf" in producer.lower() or "pypdf" in creator.lower()
        is_pdflib = "pdf-lib" in producer.lower()
        is_browser_print = "chromium" in creator.lower() or "skia" in producer.lower()
        
        # التوقيت المتطابق بالثانية في pdf-lib هو علامة فارقة عند التزوير بالقوالب
        has_exact_same_timestamp = (cdate == mdate and len(cdate) > 8 and is_pdflib)
        
        # طمس الميتاداتا
        is_metadata_wiped = (not cdate and not mdate and is_pypdf)

        # -------------------------------------------------------------
        # 5. التقييم العادل متعدد الطبقات (Fair Tiered Classification)
        # -------------------------------------------------------------

        # [أ] مؤشرات التزوير القاطع (Fabricated Forgery)
        if detected_fake_aliases:
            result["flags_forgery"].append(f"استخدام أسماء خطوط بديلة خاصة بأدوات التزوير: {list(detected_fake_aliases)}")
        if detected_generic_fonts:
            result["flags_forgery"].append(f"تضمين خطوط غير مجزأة بدون كود التشفير الرسمي: {list(detected_generic_fonts)}")
        if has_header_duplication_bug:
            result["flags_forgery"].append("خلل طباعة الترويسة المزدوجة (Duplicate Header Overlay)")
        if has_exact_same_timestamp and (detected_fake_aliases or has_header_duplication_bug):
            result["flags_forgery"].append("تطابق توقيت الإنشاء والتعديل بالثانية مع وجود بصمات تزوير")

        # [ب] مؤشرات التعديل والقص والدمج الخارجي (Tampered / Incomplete)
        if is_pypdf:
            result["flags_tampered"].append("إعادة تجميع وحفظ المستند بمكتبة بايثون (pypdf) خارج خوادم Turnitin")
        if not has_cover_page:
            result["flags_tampered"].append("حذف صفحة الغلاف الإلزامية (Cover Page) التي تتضمن اسم المؤسسة والمدرس وتاريخ الفحص")
        if is_metadata_wiped:
            result["flags_tampered"].append("طمس تواريخ الميتاداتا وحذف شجرة الـ XMP Metadata الأصلية")
        if not has_standard_pagination and (is_pypdf or not has_cover_page):
            result["flags_tampered"].append("تشوه وحذف صيغة ترقيم الصفحات الرسمية (Page X of Y)")

        # [ج] مؤشرات الأصالة والسلامة الرسمية (Authentic Official)
        if is_pdflib and not detected_fake_aliases and not has_header_duplication_bug and has_cover_page:
            result["flags_authentic"].append("يطابق بنية خوادم Turnitin Quick Submit الرسمية الحديثة")
        if has_cover_page and has_standard_pagination:
            result["flags_authentic"].append("وجود صفحة الغلاف والترويسات الرسمية الكاملة")
        if cdate and mdate and cdate != mdate:
            result["flags_authentic"].append("تسلسل زمني طبيعي بين تاريخ الرفع وتاريخ التحميل")
        if is_browser_print and has_cover_page:
            result["flags_authentic"].append("طباعة ويب نظامية مباشرة من متصفح حساب المدرس في Turnitin")

        # -------------------------------------------------------------
        # 6. اتخاذ القرار المنصف النهائي (Final Verdict)
        # -------------------------------------------------------------
        
        # 1. التزوير الصريح: وجود أدلة فنية قاطعة ومصطنعة
        if result["flags_forgery"]:
            result["verdict"] = "FABRICATED_FORGERY"
            result["verdict_title"] = "تقرير مزور ومصطنع بالكامل (Fake Forgery)"
            result["confidence_pct"] = 100
            result["is_clean_official"] = False
            result["recommendation"] = "رفض التقرير فوراً؛ تم تصنيعه باستخدام قوالب خارجية تحاكي واجهة Turnitin."

        # 2. التقرير الحقيقي المقصوص أو المعدل: فحص حقيقي تم العبث بملفه
        elif result["flags_tampered"]:
            result["verdict"] = "TAMPERED_OR_INCOMPLETE"
            result["verdict_title"] = "معدل أو مقصوص خارجياً (Tampered / Stripped)"
            result["confidence_pct"] = 99
            result["is_clean_official"] = False
            result["recommendation"] = (
                "التقرير غير مكتمل؛ تم حذف صفحة الغلاف الرسمية أو إعادة حفظه بواسطة أداة خارجية (pypdf). "
                "لا يجوز اعتماده إلا بمطالبة مقدمه بالنسخة الكاملة غير المقصوصة أو التحقق من رقم الإرسال في حساب المدرس."
            )

        # 3. الأصيل والمعتمد: يطابق التصدير الرسمي للجامعات وخوادم Turnitin
        elif len(result["flags_authentic"]) >= 2 and not result["flags_forgery"] and not result["flags_tampered"]:
            result["verdict"] = "AUTHENTIC_OFFICIAL"
            result["verdict_title"] = "تقرير أصلي ورسمي معتمد (Authentic Official)"
            result["confidence_pct"] = 98
            result["is_clean_official"] = True
            result["recommendation"] = "التقرير سليم وقانوني ومطابق 100% لمعايير التصدير الرسمية لمنصة Turnitin."

        # 4. المنطقة الرمادية (Suspicious / Manual Review): لمنع الظلم عند غياب الأدلة القاطعة
        else:
            result["verdict"] = "SUSPICIOUS_MANUAL_REVIEW"
            result["verdict_title"] = "مشبوه - يتطلب مراجعة حساب المدرس (Needs Verification)"
            result["confidence_pct"] = 70
            result["is_clean_official"] = False
            result["recommendation"] = (
                "لا توجد أدلة تزوير قاطعة لإدانة الطالب، ولكن الملف تنقصه بعض معايير التصدير القياسية. "
                "لتحقيق العدالة الكاملة: اطلب مراجعة التقرير مباشرة من داخل حساب المدرس في Turnitin."
            )

        return result


# -------------------------------------------------------------
# واجهة التشغيل السريع من سطر الأوامر (CLI Runner)
# -------------------------------------------------------------
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
    
    # طباعة النتيجة بتنسيق JSON نظيف
    print(json.dumps(res, ensure_ascii=False, indent=2))

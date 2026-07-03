// Payroll Bulk — payments and PDF export
// ─── 13. PER-EMPLOYEE PAYSLIP PDF ─────────────────────────────────────────────
window.bs_print_payslip = function(employee_id) {
  const result = window._bs.results.find((r)=>r.employee===employee_id);
  const vals   = window._bs.vals;
  if (!result || !result.slip_name) {
    frappe.show_alert({message:"No slip found for this employee.",indicator:"red"},3); return;
  }

  const load_jspdf = () => new Promise((res,rej)=>{
    const load = (src) => new Promise((r2,rj2)=>{
      if (document.querySelector(`script[src="${src}"]`)) { r2(); return; }
      const s=document.createElement("script"); s.src=src;
      s.onload=r2; s.onerror=rj2; document.head.appendChild(s);
    });
    load("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")
      .then(()=>load("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"))
      .then(res).catch(rej);
  });

  frappe.show_alert({message:"Generating payslip…",indicator:"blue"},3);

  load_jspdf().then(()=>{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
    const W   = doc.internal.pageSize.getWidth();
    const today = frappe.datetime.get_today();

    // Header
    doc.setFillColor(22,78,99);
    doc.rect(0,0,W,24,"F");
    doc.setTextColor(255,255,255);
    doc.setFontSize(16); doc.setFont("helvetica","bold");
    doc.text("SALARY SLIP", W/2, 12, {align:"center"});
    doc.setFontSize(8); doc.setFont("helvetica","normal");
    doc.text(`${vals.company||""}   |   Period: ${vals.start_date} to ${vals.end_date}`, W/2, 19, {align:"center"});

    // Employee info box
    doc.setFillColor(26,29,39);
    doc.roundedRect(10,28,W-20,24,3,3,"F");
    doc.setTextColor(100,180,220); doc.setFontSize(11); doc.setFont("helvetica","bold");
    doc.text(result.employee_name||result.employee, 16, 37);
    doc.setTextColor(160,165,175); doc.setFontSize(8); doc.setFont("helvetica","normal");
    doc.text(`Employee ID: ${result.employee}`, 16, 44);
    doc.text(`Slip No: ${result.slip_name}`, 16, 49);
    doc.text(`Posting Date: ${vals.posting_date||today}`, W-14, 44, {align:"right"});
    doc.text(`Frequency: ${vals.payroll_frequency||""}`, W-14, 49, {align:"right"});

    // Earnings table
    const earnings = [
      ["Basic Salary (CTC)", fmt_num(result.ctc)],
    ];
    if (result.ot_amount > 0) {
      earnings.push(["Overtime Pay", fmt_num(result.ot_amount)]);
    }
    earnings.push(["", ""]);
    earnings.push([{ content:"GROSS PAY", styles:{fontStyle:"bold",textColor:[74,222,128]} },
                   { content:fmt_num(result.gross), styles:{fontStyle:"bold",textColor:[74,222,128]} }]);

    doc.autoTable({
      head:[["EARNINGS","AMOUNT"]],
      body: earnings,
      startY:58,
      margin:{left:10,right:W/2+2},
      styles:{fontSize:9,cellPadding:3},
      headStyles:{fillColor:[22,78,99],textColor:255,fontStyle:"bold",fontSize:8},
      alternateRowStyles:{fillColor:[26,29,39]},
      theme:"grid",
      tableWidth: W/2-14,
    });

    // Deductions table
    const deductions = [];
    if (result.adv_deduct > 0) {
      deductions.push(["Advance Deduction", fmt_num(result.adv_deduct)]);
    }
    deductions.push(["", ""]);
    deductions.push([{ content:"TOTAL DEDUCTIONS", styles:{fontStyle:"bold",textColor:[248,113,113]} },
                     { content:fmt_num(result.adv_deduct), styles:{fontStyle:"bold",textColor:[248,113,113]} }]);

    doc.autoTable({
      head:[["DEDUCTIONS","AMOUNT"]],
      body: deductions.length > 2 ? deductions : [["No deductions","0.00"]],
      startY:58,
      margin:{left:W/2+4,right:10},
      styles:{fontSize:9,cellPadding:3},
      headStyles:{fillColor:[127,29,29],textColor:255,fontStyle:"bold",fontSize:8},
      alternateRowStyles:{fillColor:[26,29,39]},
      theme:"grid",
      tableWidth: W/2-14,
    });

    // Net pay box
    const finalY = Math.max(doc.lastAutoTable.finalY, 58+40) + 8;
    doc.setFillColor(5,46,22);
    doc.roundedRect(10,finalY,W-20,16,3,3,"F");
    doc.setTextColor(74,222,128); doc.setFontSize(14); doc.setFont("helvetica","bold");
    doc.text("NET PAY", 18, finalY+10);
    doc.text(fmt_num(result.net), W-14, finalY+10, {align:"right"});

    // Status stamp
    doc.setFontSize(9); doc.setFont("helvetica","normal");
    doc.setTextColor(160,163,175);
    doc.text(
      vals.submit_slips ? "✓ Submitted" : "✓ Processed",
      W/2, finalY+22, {align:"center"}
    );

    // Footer
    const H = doc.internal.pageSize.getHeight();
    doc.setFontSize(7); doc.setTextColor(100,100,120);
    doc.text(`Generated: ${today}   |   ${vals.company||""}`, W/2, H-6, {align:"center"});

    doc.save(`payslip_${result.employee}_${vals.start_date}.pdf`);
    frappe.show_alert({message:"Payslip downloaded ✓",indicator:"green"},3);
  });
};

// ─── 14. SINGLE JOURNAL ENTRY ────────────────────────────────────────────────
async function bs_persist_payment_reference(employee_id, journal_name, payment_status = "Payment Created") {
  const frm = window._bs.frm;
  const row = window._bs.rows.find((item) => item.employee === employee_id);
  if (row) {
    row.payment_entry = journal_name || "";
    row.payment_status = payment_status || "Payment Created";
    if (!["Cancelled", "Failed"].includes(row.status || "")) {
      row.status = payment_status === "Paid" ? "Completed" : "Payment Created";
    }
  }
  const child = row ? bs_find_child_row(frm, row) : null;
  if (child) {
    child.payment_entry = journal_name || "";
    child.payment_status = payment_status || "Payment Created";
    if (!["Cancelled", "Failed"].includes(child.status || "")) {
      child.status = payment_status === "Paid" ? "Completed" : "Payment Created";
    }
  }
  if (frm) {
    bs_sync_to_frm(frm);
    await new Promise((resolve, reject) =>
      frm.save("Save", (r) => (r.exc ? reject(new Error(r.exc)) : resolve(r))),
    );
  }
}

window.bs_create_single_payment = function(employee_id) {
  const frm = window._bs.frm;
  const row = (window._bs.rows || []).find((item) => item.employee === employee_id)
    || (frm?.doc?.employees || []).find((item) => item.employee === employee_id);
  const result = window._bs.results.find((r)=>r.employee===employee_id) || {
    employee: employee_id,
    employee_name: row?.employee_name || employee_id,
    slip_name: row?.salary_slip || "",
    net: parseFloat(row?.net || row?.net_pay || 0),
    payment_entry: row?.payment_entry || "",
  };
  const vals = window._bs.vals || {
    company: window._bs.frm?.doc?.company || frappe.defaults.get_default("company"),
    start_date: window._bs.frm?.doc?.start_date,
    end_date: window._bs.frm?.doc?.end_date,
  };
  if (!result || !result.slip_name) {
    frappe.show_alert({message:"No slip for this employee.",indicator:"red"},3); return;
  }
  const batch_row = row;
  if (batch_row && batch_row.salary_slip_status !== "Submitted") {
    frappe.show_alert({message:"Only submitted Salary Slips can be paid.",indicator:"orange"},4); return;
  }

  const pay_acc_ctrl = window._bs._pay_acc_ctrl;
  const pre_acct = pay_acc_ctrl ? pay_acc_ctrl.get_value() : "";

  const d = new frappe.ui.Dialog({
    title: `Payment — ${result.employee_name||result.employee}`,
    size: "small",
    fields:[
      { fieldtype:"HTML", fieldname:"info",
        options:`<div class="bs-notice bs-notice-info" style="margin-bottom:10px">
          Employee: <b>${result.employee_name}</b><br>
          Salary Slip: <b>${result.slip_name}</b><br>
          Net Pay: <b>${fmt_num(result.net)}</b>
        </div>` },
      { fieldtype:"Link", fieldname:"pay_from", options:"Account",
        label:"Pay From Account", reqd:1, default: pre_acct,
        get_query:()=>({ filters:[
          ["account_type","in",["Cash","Bank"]],
          ["company","=",vals.company||frappe.defaults.get_default("company")],
        ]}) },
      { fieldtype:"Currency", fieldname:"amount", label:"Amount",
        reqd:1, default: result.net },
      { fieldtype:"Date", fieldname:"payment_date", label:"Payment Date",
        reqd:1, default: frappe.datetime.get_today() },
      { fieldtype:"Data", fieldname:"reference_no", label:"Reference / Cheque No" },
    ],
    primary_action_label:"Create Journal Entry",
    async primary_action(v) {
      if (!v.pay_from) {
        frappe.show_alert({message:"Select a pay-from account.",indicator:"red"},4); return;
      }
      d.hide();
      try {
        const payable_account = await bs_get_salary_payable_account(result.slip_name, vals.company);
        const pay_from_meta = await bs_call("frappe.client.get_value", {
          doctype: "Account",
          filters: { name: v.pay_from },
          fieldname: ["account_type"],
        });
        const account_type = pay_from_meta.message?.account_type || "";
        const voucher_type = account_type === "Cash" ? "Cash Entry" : "Bank Entry";
        const pe = await bs_call("frappe.client.insert",{
          doc:{
            doctype: "Journal Entry",
            voucher_type,
            posting_date: v.payment_date,
            cheque_no: v.reference_no || "",
            cheque_date: v.payment_date,
            company: vals.company||frappe.defaults.get_default("company"),
            user_remark: `Salary payment for ${result.employee_name} — Slip ${result.slip_name}`,
            accounts: [
              {
                account: payable_account,
                party_type: "Employee",
                party: result.employee,
                reference_type: "Salary Slip",
                reference_name: result.slip_name,
                debit_in_account_currency: v.amount,
                credit_in_account_currency: 0,
              },
              {
                account: v.pay_from,
                debit_in_account_currency: 0,
                credit_in_account_currency: v.amount,
              },
            ],
          },
        });
        result.payment_entry = pe.message.name;
        const safe_id = employee_id.replace(/[^a-z0-9]/gi,"-");
        const btn = document.getElementById(`bs-pay-btn-${safe_id}`);
        if (btn) {
          btn.textContent = `✓ ${pe.message.name}`;
          btn.disabled = true;
          btn.style.color = "var(--bs-green)";
        }
        await bs_persist_payment_reference(employee_id, pe.message.name, "Payment Created");
        frappe.show_alert({message:`Journal Entry <b>${pe.message.name}</b> created ✓`,indicator:"green"},5);
      } catch(err) {
        frappe.msgprint({title:"Payment Error",message:err.message||String(err),indicator:"red"});
      }
    },
  });
  d.show();
};

// ─── 15. BULK PAYMENT ENTRY ───────────────────────────────────────────────────
async function bs_create_bulk_payment(success_results, pay_from_account, vals) {
  const notice = (msg,type="info") => bs_notice("bs-pay-notice",msg,type);
  notice("⏳ Creating bulk journal entry…");

  const eligible_results = success_results.filter((result) => {
    const row = window._bs.rows.find((item) => item.employee === result.employee);
    return row && row.salary_slip_status === "Submitted";
  });
  if (!eligible_results.length) {
    notice("⚠ Only submitted Salary Slips can be paid.", "warn");
    return;
  }

  const total_net = eligible_results.reduce((s,r)=>s+r.net,0);
  try {
    const pay_from_meta = await bs_call("frappe.client.get_value", {
      doctype: "Account",
      filters: { name: pay_from_account },
      fieldname: ["account_type"],
    });
    const account_type = pay_from_meta.message?.account_type || "";
    const voucher_type = account_type === "Cash" ? "Cash Entry" : "Bank Entry";
    const payable_accounts = await Promise.all(eligible_results.map((r) => bs_get_salary_payable_account(r.slip_name, vals.company)));
    const accounts = eligible_results.map((r, idx) => ({
      account: payable_accounts[idx],
      party_type: "Employee",
      party: r.employee,
      reference_type: "Salary Slip",
      reference_name: r.slip_name,
      debit_in_account_currency: r.net,
      credit_in_account_currency: 0,
    }));
    accounts.push({
      account: pay_from_account,
      debit_in_account_currency: 0,
      credit_in_account_currency: total_net,
    });
    const pe = await bs_call("frappe.client.insert",{
      doc:{
        doctype: "Journal Entry",
        voucher_type,
        posting_date: frappe.datetime.get_today(),
        cheque_date: frappe.datetime.get_today(),
        company: vals.company||frappe.defaults.get_default("company"),
        user_remark: `Bulk salary payment — Period: ${vals.start_date} to ${vals.end_date} — ${eligible_results.length} employees`,
        accounts,
      },
    });
    notice(`✓ Journal Entry <b>${pe.message.name}</b> created for ${fmt_num(total_net)}!`,"success");
    for (const result of eligible_results) {
      result.payment_entry = pe.message.name;
      await bs_persist_payment_reference(result.employee, pe.message.name, "Payment Created");
    }
  } catch(err) {
    notice(`❌ ${err.message||String(err)}`,"error");
  }
}

async function bs_get_salary_payable_account(slip_name, company) {
  const refs = await bs_call("frappe.client.get_list", {
    doctype: "GL Entry",
    filters: {
      voucher_type: "Salary Slip",
      voucher_no: slip_name,
      company: company || frappe.defaults.get_default("company"),
      is_cancelled: 0,
    },
    fields: ["account", "credit", "credit_in_account_currency"],
    order_by: "credit_in_account_currency desc, credit desc, creation asc",
    limit_page_length: 20,
  });
  const rows = refs.message || [];
  const payable = rows.find((row) => flt(row.credit_in_account_currency || row.credit) > 0);
  if (!payable?.account) {
    throw new Error(`Could not detect payable account from Salary Slip ${slip_name}.`);
  }
  return payable.account;
}

// ─── 16. SUMMARY PDF ──────────────────────────────────────────────────────────
function bs_download_pdf(results, vals, total_gross, total_ded, total_net, total_ot, success, failed) {
  const load = (src) => new Promise((res,rej)=>{
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s=document.createElement("script"); s.src=src;
    s.onload=res; s.onerror=rej; document.head.appendChild(s);
  });

  frappe.show_alert({message:"Preparing PDF…",indicator:"blue"},3);
  load("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")
    .then(()=>load("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"))
    .then(()=>{
      const { jsPDF } = window.jspdf;
      const doc   = new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});
      const today = frappe.datetime.get_today();

      // Header
      doc.setFillColor(22,78,99); doc.rect(0,0,297,18,"F");
      doc.setTextColor(255,255,255);
      doc.setFontSize(13); doc.setFont("helvetica","bold");
      doc.text("Bulk Salary Creation — Summary Report", 12, 12);
      doc.setFontSize(8); doc.setFont("helvetica","normal");
      doc.text(`Period: ${vals.start_date} → ${vals.end_date}   |   Company: ${vals.company||"—"}   |   Generated: ${today}`,12,17.5);

      // Stat badges
      let bx=12; const by=24;
      const badge = (label,color_fill,color_text,color_border,w) => {
        doc.setFillColor(...color_fill); doc.setDrawColor(...color_border);
        doc.roundedRect(bx,by,w,8,2,2,"FD");
        doc.setTextColor(...color_text); doc.setFontSize(8); doc.setFont("helvetica","bold");
        doc.text(label, bx+4, by+5.5);
        bx+=w+4;
      };
      badge(`✓ ${success.length} Succeeded`,[220,252,231],[22,101,52],[187,247,208],52);
      if (failed.length) badge(`✕ ${failed.length} Failed`,[254,226,226],[127,29,29],[254,202,202],40);
      badge(`OT: ${fmt_num(total_ot)}`,[254,243,199],[146,64,14],[253,230,138],50);
      badge(`Gross: ${fmt_num(total_gross)}`,[219,234,254],[30,58,138],[191,219,254],56);
      badge(`Net: ${fmt_num(total_net)}`,[209,250,229],[6,78,59],[167,243,208],56);

      // Table
      doc.autoTable({
        head:[["Employee","Name","Salary Slip","CTC","Overtime","Gross","Adv.Deduct","Net Pay","Status"]],
        body: results.map((r)=>[
          r.employee,
          r.employee_name!==r.employee?r.employee_name:"",
          r.slip_name||"—",
          r.status==="Success"?fmt_num(r.ctc):"—",
          r.status==="Success"?fmt_num(r.ot_amount):"—",
          r.status==="Success"?fmt_num(r.gross):"—",
          r.status==="Success"?fmt_num(r.adv_deduct):"—",
          r.status==="Success"?fmt_num(r.net):"—",
          r.status==="Success"?(vals.submit_slips?"Submitted":"Processed"):"FAILED",
        ]),
        startY:36, margin:{left:10,right:10},
        styles:{fontSize:7.5,cellPadding:2.5,overflow:"linebreak"},
        headStyles:{fillColor:[22,78,99],textColor:255,fontStyle:"bold",fontSize:7},
        alternateRowStyles:{fillColor:[248,250,252]},
        columnStyles:{
          0:{cellWidth:24},1:{cellWidth:32},2:{cellWidth:32,fontSize:6.5},
          3:{halign:"right",cellWidth:24},4:{halign:"right",cellWidth:22},
          5:{halign:"right",cellWidth:24},6:{halign:"right",cellWidth:22},
          7:{halign:"right",cellWidth:24,fontStyle:"bold"},
          8:{halign:"center",cellWidth:20},
        },
        didParseCell(data){
          if (data.section==="body"&&data.column.index===8) {
            const ok = data.cell.raw==="Submitted"||data.cell.raw==="Processed";
            data.cell.styles.textColor = ok?[22,101,52]:[185,28,28];
            data.cell.styles.fontStyle = "bold";
          }
        },
      });

      const finalY = doc.lastAutoTable.finalY+5;
      doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(30,30,30);
      doc.text(`Totals — Gross: ${fmt_num(total_gross)}   OT: ${fmt_num(total_ot)}   Adv.Deduct: ${fmt_num(total_ded)}   Net: ${fmt_num(total_net)}`,12,finalY);

      const H=doc.internal.pageSize.getHeight();
      doc.setFontSize(7.5); doc.setFont("helvetica","normal"); doc.setTextColor(156,163,175);
      doc.text(`Bulk Salary Creation  |  ${today}`,285,H-6,{align:"right"});

      doc.save(`bulk_salary_${vals.start_date}_${vals.end_date}.pdf`);
      frappe.show_alert({message:"PDF downloaded ✓",indicator:"green"},3);
    })
    .catch((e)=>frappe.msgprint({title:"PDF Error",message:String(e),indicator:"red"}));
}


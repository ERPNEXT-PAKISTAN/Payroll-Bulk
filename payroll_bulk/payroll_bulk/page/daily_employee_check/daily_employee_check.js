frappe.pages["daily-employee-check"].on_page_load = function (wrapper) {
	const METHOD = "payroll_bulk.payroll_bulk.page.daily_employee_check.daily_employee_check.get_report_data";
	const MONTHS = [
		"Jan", "Feb", "Mar", "Apr", "May", "Jun",
		"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
	];

	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Daily Employee Checkin"),
		single_column: true,
	});

	const $root = $(`
		<div class="dec-page">
			<style>
				.dec-page{padding:12px 16px 24px;font-size:12px;color:#1e293b}
				.dec-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:10px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:12px}
				.dec-filter-item{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}
				.dec-filter-item label{font-size:11px;font-weight:700;color:#475569;white-space:nowrap;margin:0;line-height:1}
				.dec-filter-item select,.dec-filter-item input[type="text"]{height:28px;border:1px solid #cbd5e1;border-radius:4px;padding:0 8px;font-size:12px;background:#fff;min-width:72px}
				.dec-filter-item .form-group{margin:0!important;padding:0!important}
				.dec-filter-item .link-field{width:150px;min-width:150px}
				.dec-filter-item .link-field .awesomplete input,.dec-filter-item .link-field input{height:28px!important;min-height:28px!important;font-size:12px!important}
				.dec-filter-item.dec-filter-wide .link-field{width:180px;min-width:180px}
				.dec-filter-item.dec-filter-emp input{min-width:150px;width:150px}
				.dec-actions{display:inline-flex;align-items:center;gap:6px;margin-left:auto}
				.dec-btn{height:28px;padding:0 12px;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid transparent;line-height:28px}
				.dec-btn-primary{background:#2563eb;color:#fff;border-color:#2563eb}
				.dec-btn-secondary{background:#fff;color:#334155;border-color:#cbd5e1}
				.dec-toolbar{display:flex;align-items:center;justify-content:space-between;margin:8px 0 10px;color:#475569;font-size:12px;flex-wrap:wrap;gap:6px}
				.dec-table-wrap{overflow:auto;border:1px solid #e2e8f0;border-radius:8px;background:#fff;max-width:100%}
				.dec-table{border-collapse:separate;border-spacing:0;min-width:100%;font-size:11px;table-layout:fixed}
				.dec-table th,.dec-table td{border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:3px 4px;text-align:center;vertical-align:middle;background:#fff}
				.dec-table thead th{background:#f8fafc;font-weight:800;color:#334155;position:sticky;top:0;z-index:5}
				.dec-table .dec-col-sr{width:36px;min-width:36px;max-width:36px;left:0}
				.dec-table .dec-col-emp{width:150px;min-width:150px;max-width:150px;left:36px;text-align:left}
				.dec-table .dec-col-dept{width:120px;min-width:120px;max-width:120px;left:186px;text-align:left}
				.dec-table .dec-col-tot{width:40px;min-width:40px;max-width:40px;left:306px;font-weight:700}
				.dec-table .dec-sticky{position:sticky;z-index:4;box-shadow:1px 0 0 #e2e8f0}
				.dec-table thead .dec-sticky{z-index:6;background:#f8fafc}
				.dec-table tbody .dec-sticky{background:#fff}
				.dec-table .dec-day{width:54px;min-width:54px;max-width:54px}
				.dec-emp-name{font-weight:700;color:#0f172a;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:142px;display:block}
				.dec-emp-id{font-size:10px;color:#64748b;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:142px;display:block}
				.dec-dept-text{font-size:11px;color:#334155;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:112px;display:block}
				.dec-cell-in,.dec-cell-out{color:#0f172a;line-height:1.25;font-size:11px}
				.dec-cell-ot{color:#dc2626;font-weight:700;line-height:1.25;font-size:10px}
				.dec-mark-s{color:#64748b;font-weight:800}
				.dec-mark-h{color:#b45309;font-weight:800}
				.dec-empty{padding:32px;text-align:center;color:#64748b}
				@media print{.dec-filters,.dec-actions{display:none!important}.dec-table-wrap{overflow:visible}}
			</style>
			<div class="dec-filters">
				<div class="dec-filter-item"><label>${__("Month")}</label><select id="dec-month"></select></div>
				<div class="dec-filter-item"><label>${__("Year")}</label><select id="dec-year"></select></div>
				<div class="dec-filter-item dec-filter-wide"><label>${__("Company")}</label><div id="dec-company"></div></div>
				<div class="dec-filter-item"><label>${__("Department")}</label><div id="dec-department"></div></div>
				<div class="dec-filter-item"><label>${__("Shift")}</label><div id="dec-shift"></div></div>
				<div class="dec-filter-item dec-filter-emp"><label>${__("Employee")}</label><input id="dec-employee" type="text" placeholder="${__("Search name or ID")}" /></div>
				<div class="dec-actions">
					<button class="dec-btn dec-btn-primary" id="dec-load">${__("Load")}</button>
					<button class="dec-btn dec-btn-secondary" id="dec-reset">${__("Reset")}</button>
					<button class="dec-btn dec-btn-secondary" id="dec-print">${__("Print")}</button>
				</div>
			</div>
			<div class="dec-toolbar">
				<div id="dec-count">${__("Employees")}: 0</div>
				<div>${__("S = Weekly Off")} | ${__("H = Holiday")} | <span style="color:#dc2626;font-weight:700">${__("OT = OUT − IN")}</span></div>
			</div>
			<div class="dec-table-wrap" id="dec-table-wrap">
				<div class="dec-empty">${__("Select filters and click Load.")}</div>
			</div>
		</div>
	`);

	page.main.append($root);

	const now = new Date();
	const $month = $root.find("#dec-month");
	const $year = $root.find("#dec-year");
	MONTHS.forEach((label, idx) => {
		$month.append(`<option value="${idx + 1}" ${idx + 1 === now.getMonth() + 1 ? "selected" : ""}>${label}</option>`);
	});
	for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 1; y += 1) {
		$year.append(`<option value="${y}" ${y === now.getFullYear() ? "selected" : ""}>${y}</option>`);
	}

	const company_ctrl = frappe.ui.form.make_control({
		parent: $root.find("#dec-company")[0],
		df: { fieldtype: "Link", options: "Company", placeholder: __("All Company") },
		render_input: true,
	});
	company_ctrl.set_value(frappe.defaults.get_default("company") || "");

	const department_ctrl = frappe.ui.form.make_control({
		parent: $root.find("#dec-department")[0],
		df: { fieldtype: "Link", options: "Department", placeholder: __("All Department") },
		render_input: true,
	});

	const shift_ctrl = frappe.ui.form.make_control({
		parent: $root.find("#dec-shift")[0],
		df: { fieldtype: "Link", options: "Shift Type", placeholder: __("All Shift") },
		render_input: true,
	});

	function render_table(data) {
		const employees = data.employees || [];
		const days_in_month = data.days_in_month || 31;
		$root.find("#dec-count").text(`${__("Employees")}: ${employees.length}`);
		if (!employees.length) {
			$root.find("#dec-table-wrap").html(`<div class="dec-empty">${__("No records found.")}</div>`);
			return;
		}

		let head = `<table class="dec-table"><thead><tr>
			<th class="dec-sticky dec-col-sr">${__("Sr")}</th>
			<th class="dec-sticky dec-col-emp">${__("Employee")}</th>
			<th class="dec-sticky dec-col-dept">${__("Department")}</th>
			<th class="dec-sticky dec-col-tot">${__("Tot")}</th>`;
		for (let d = 1; d <= days_in_month; d += 1) {
			head += `<th class="dec-day">${d}</th>`;
		}
		head += "</tr></thead><tbody>";

		let body = "";
		employees.forEach((row, idx) => {
			body += `<tr>
				<td class="dec-sticky dec-col-sr">${idx + 1}</td>
				<td class="dec-sticky dec-col-emp">
					<span class="dec-emp-name" title="${frappe.utils.escape_html(row.employee_name || "")}">${frappe.utils.escape_html(row.employee_name || "")}</span>
					<span class="dec-emp-id" title="${frappe.utils.escape_html(row.employee || "")}">${frappe.utils.escape_html(row.employee || "")}</span>
				</td>
				<td class="dec-sticky dec-col-dept"><span class="dec-dept-text" title="${frappe.utils.escape_html(row.department || "")}">${frappe.utils.escape_html(row.department || "")}</span></td>
				<td class="dec-sticky dec-col-tot">${row.total || 0}</td>`;
			for (let d = 1; d <= days_in_month; d += 1) {
				const cell = (row.days || {})[String(d)] || {};
				if (cell.mark === "S") {
					body += `<td class="dec-day"><span class="dec-mark-s">S</span></td>`;
				} else if (cell.mark === "H") {
					body += `<td class="dec-day"><span class="dec-mark-h">H</span></td>`;
				} else if (cell.in || cell.out || cell.ot) {
					body += `<td class="dec-day">
						<div class="dec-cell-in">${cell.in || ""}</div>
						<div class="dec-cell-out">${cell.out || ""}</div>
						<div class="dec-cell-ot">${cell.ot || ""}</div>
					</td>`;
				} else {
					body += `<td class="dec-day"></td>`;
				}
			}
			body += "</tr>";
		});
		$root.find("#dec-table-wrap").html(`${head}${body}</tbody></table>`);
	}

	async function load_data() {
		$root.find("#dec-table-wrap").html(`<div class="dec-empty">${__("Loading...")}</div>`);
		try {
			const r = await frappe.call({
				method: METHOD,
				args: {
					month: $month.val(),
					year: $year.val(),
					company: company_ctrl.get_value() || "",
					department: department_ctrl.get_value() || "",
					shift: shift_ctrl.get_value() || "",
					employee: $root.find("#dec-employee").val() || "",
				},
			});
			render_table(r.message || {});
		} catch (err) {
			console.error(err);
			$root.find("#dec-table-wrap").html(`<div class="dec-empty" style="color:#b91c1c">${__("Failed to load report.")}</div>`);
		}
	}

	$root.find("#dec-load").on("click", load_data);
	let dec_reload_timer = null;
	function schedule_auto_load() {
		clearTimeout(dec_reload_timer);
		dec_reload_timer = setTimeout(load_data, 400);
	}
	$month.on("change", schedule_auto_load);
	$year.on("change", schedule_auto_load);
	$root.find("#dec-employee").on("change blur", schedule_auto_load);
	company_ctrl.$input?.on("change awesomplete-selectcomplete", schedule_auto_load);
	department_ctrl.$input?.on("change awesomplete-selectcomplete", schedule_auto_load);
	shift_ctrl.$input?.on("change awesomplete-selectcomplete", schedule_auto_load);
	$root.find("#dec-reset").on("click", () => {
		$month.val(now.getMonth() + 1);
		$year.val(now.getFullYear());
		company_ctrl.set_value(frappe.defaults.get_default("company") || "");
		department_ctrl.set_value("");
		shift_ctrl.set_value("");
		$root.find("#dec-employee").val("");
		$root.find("#dec-table-wrap").html(`<div class="dec-empty">${__("Select filters and click Load.")}</div>`);
		$root.find("#dec-count").text(`${__("Employees")}: 0`);
	});
	$root.find("#dec-print").on("click", () => window.print());
};

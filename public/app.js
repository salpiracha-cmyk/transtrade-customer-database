const state = {
  summary: null,
  customers: [],
  countries: [],
  sourceTypes: [],
  activeView: "dashboard",
  cardUploadBusy: false,
  dashboardSearchCustomers: [],
  editingCustomerId: null,
  outreachTestPassed: false,
  outreachPreviewTotal: 0
};

const titles = {
  dashboard: ["Dashboard", "Local-first customer database foundation"],
  customers: ["Customers", "Search, edit, archive, and export buyer records"],
  companyContacts: ["Miscellaneous", "Non-buyer contacts excluded from outreach exports"],
  research: ["Research Needed", "Fix incomplete buyer records before outreach"],
  exports: ["Clean Exports", "Download clean outreach lists and cleanup workbooks"],
  import: ["Import", "Bring in clean Excel lists, verified workbooks, or card master files"],
  duplicates: ["Duplicates", "Review likely repeated customers before merging"],
  cards: ["Cards", "Save new card photos to the server"],
  outreach: ["Outreach", "Campaign controls will use only verified, unsuppressed records"]
};

document.querySelectorAll(".nav").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});
document.getElementById("addMainBtn").addEventListener("click", openAddDialog);
document.getElementById("exportViewBtn").addEventListener("click", () => switchView("exports"));
document.getElementById("chooseCardBtn").addEventListener("click", () => {
  document.getElementById("addDialog").close();
  openCardDialog();
});
document.getElementById("chooseManualBtn").addEventListener("click", () => {
  document.getElementById("addDialog").close();
  openCustomerDialog();
});
document.getElementById("closeAddDialogBtn").addEventListener("click", () => document.getElementById("addDialog").close());
document.getElementById("dashboardSearchInput").addEventListener("input", debounce(loadDashboardSearch, 250));
document.getElementById("searchInput").addEventListener("input", debounce(loadCustomers, 250));
document.getElementById("countryFilter").addEventListener("change", loadCustomers);
document.getElementById("statusFilter").addEventListener("change", loadCustomers);
document.getElementById("qualityFilter").addEventListener("change", loadCustomers);
document.getElementById("contactFilter").addEventListener("change", loadCustomers);
document.getElementById("sourceFilter").addEventListener("change", loadCustomers);
document.getElementById("newCustomerBtn").addEventListener("click", openAddDialog);
document.getElementById("saveCustomerBtn").addEventListener("click", saveManualCustomer);
document.getElementById("importForm").addEventListener("submit", importFile);
document.getElementById("cardForm").addEventListener("submit", uploadCard);
document.getElementById("quickCardForm").addEventListener("submit", uploadQuickCard);
document.getElementById("saveCardBtn").addEventListener("click", uploadQuickCard);
document.getElementById("cancelCardBtn").addEventListener("click", closeCardDialog);
document.getElementById("ocrCustomerForm").addEventListener("submit", saveOcrCustomer);
document.getElementById("discardOcrBtn").addEventListener("click", discardOcrReview);
document.getElementById("autoFillCardBtn").addEventListener("click", () => autoFillCurrentCard({ manual: true }));
document.getElementById("savePhoneContactBtn").addEventListener("click", saveCurrentCardToPhone);
document.getElementById("duplicateTypeFilter").addEventListener("change", loadDuplicates);
document.getElementById("reloadDuplicatesBtn").addEventListener("click", loadDuplicates);
document.getElementById("companyContactSearch").addEventListener("input", debounce(loadCompanyContacts, 250));
document.getElementById("reloadCompanyContactsBtn").addEventListener("click", loadCompanyContacts);
document.getElementById("researchSearch").addEventListener("input", debounce(loadResearch, 250));
document.getElementById("researchSourceFilter").addEventListener("change", loadResearch);
document.getElementById("reloadResearchBtn").addEventListener("click", loadResearch);
document.querySelectorAll(".filePickButton").forEach((button) => button.addEventListener("click", openPhotoPicker));
document.getElementById("cardFileInput").addEventListener("change", handleCardFileSelected);
document.getElementById("quickCardFileInput").addEventListener("change", handleCardFileSelected);
document.getElementById("outreachCountry").addEventListener("change", () => {
  state.outreachTestPassed = false;
  updateOutreachSendButton();
  previewOutreachList();
});
document.getElementById("outreachSubject").addEventListener("input", () => {
  state.outreachTestPassed = false;
  updateOutreachSendButton();
});
document.getElementById("outreachBody").addEventListener("input", () => {
  state.outreachTestPassed = false;
  updateOutreachSendButton();
});
document.getElementById("previewOutreachBtn").addEventListener("click", previewOutreachList);
document.getElementById("sendTestOutreachBtn").addEventListener("click", sendOutreachTest);
document.getElementById("startOutreachBtn").addEventListener("click", startOutreachCampaign);
document.getElementById("draftOutreachBtn").addEventListener("click", draftOutreachEmail);

await refresh();
await loadAiStatus();

async function refresh() {
  await loadSummary();
  await loadCustomers();
  await loadDashboardSearch();
  if (state.activeView === "duplicates") await loadDuplicates();
}

function switchView(view) {
  state.activeView = view;
  document.querySelectorAll(".nav").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === view));
  document.getElementById("viewTitle").textContent = titles[view][0];
  document.getElementById("viewSubtitle").textContent = titles[view][1];
  if (view === "duplicates") loadDuplicates();
  if (view === "companyContacts") loadCompanyContacts();
  if (view === "research") loadResearch();
  if (view === "cards") loadAiStatus();
  if (view === "outreach") loadOutreachStatus();
}

function openAddDialog() {
  document.getElementById("addDialog").showModal();
}

function openCustomerDialog(customer = null) {
  const dialog = document.getElementById("customerDialog");
  const form = document.getElementById("customerForm");
  form.reset();
  state.editingCustomerId = customer?.id || null;
  form.querySelector("h2").textContent = customer ? "Edit customer" : "Add customer";
  document.getElementById("saveCustomerBtn").textContent = customer ? "Save changes" : "Save";
  if (customer) {
    for (const field of ["company", "person", "role", "country", "city", "mobile", "phone", "email", "website", "notes"]) {
      if (form.elements[field]) form.elements[field].value = customer[field] || "";
    }
  }
  dialog.showModal();
}

function openCardDialog() {
  document.getElementById("cardDialog").showModal();
}

function closeCardDialog() {
  document.getElementById("quickCardForm").reset();
  document.getElementById("quickCardFileName").textContent = "No card photo selected.";
  document.getElementById("cardDialog").close();
}

function openPhotoPicker(event) {
  const button = event.currentTarget;
  const input = document.getElementById(button.dataset.input);
  if (!input) return;
  input.value = "";
  if (button.dataset.mode === "camera") {
    input.setAttribute("capture", "environment");
  } else {
    input.removeAttribute("capture");
  }
  input.click();
}

function updateSelectedPhotoName(event) {
  const input = event.currentTarget;
  const labelId = input.id === "quickCardFileInput" ? "quickCardFileName" : "cardFileName";
  const label = document.getElementById(labelId);
  if (!label) return;
  label.textContent = input.files?.[0]?.name || "No card photo selected.";
}

async function handleCardFileSelected(event) {
  updateSelectedPhotoName(event);
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file || state.cardUploadBusy) return;
  if (input.id === "quickCardFileInput") {
    await uploadQuickCard();
  } else {
    await uploadCard();
  }
}

async function loadSummary() {
  const summary = await api("/api/summary");
  state.summary = summary;
  state.countries = summary.countries;
  state.sourceTypes = summary.sourceTypes || [];
  document.getElementById("mActive").textContent = summary.totals.active;
  document.getElementById("mClean").textContent = summary.totals.clean;
  document.getElementById("mEmailReady").textContent = summary.totals.emailReady;
  document.getElementById("mResearch").textContent = summary.totals.researchNeeded;
  document.getElementById("mDuplicates").textContent = summary.totals.duplicateGroups;
  renderCountries(summary.countries);
  renderRecentImports(summary.recentImports);
  const countryFilter = document.getElementById("countryFilter");
  const selected = countryFilter.value;
  countryFilter.innerHTML = `<option value="">All countries</option>` + summary.countries.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  countryFilter.value = selected;
  const sourceFilter = document.getElementById("sourceFilter");
  const selectedSource = sourceFilter.value;
  sourceFilter.innerHTML = `<option value="">All sources</option>` + state.sourceTypes.map((s) => `<option value="${escapeHtml(s)}">${labelSource(s)}</option>`).join("");
  sourceFilter.value = selectedSource;
  const researchSourceFilter = document.getElementById("researchSourceFilter");
  const selectedResearchSource = researchSourceFilter.value;
  researchSourceFilter.innerHTML = `<option value="">All sources</option>` + state.sourceTypes.map((s) => `<option value="${escapeHtml(s)}">${labelSource(s)}</option>`).join("");
  researchSourceFilter.value = selectedResearchSource;
}

function renderCountries(countries) {
  const el = document.getElementById("countryList");
  if (!el) return;
  el.innerHTML = countries.length
    ? countries.map((country) => `<span class="countryPill">${escapeHtml(country)}</span>`).join("")
    : `<span class="muted">No countries imported yet.</span>`;
}

function renderRecentImports(imports) {
  const el = document.getElementById("recentImports");
  el.innerHTML = imports.length
    ? imports.map((item) => `<div class="importItem"><strong>${escapeHtml(item.filename)}</strong><div class="muted">${item.importedCount} records · ${escapeHtml(item.sourceType)} · ${new Date(item.createdAt).toLocaleString()}</div></div>`).join("")
    : `<span class="muted">No imports yet.</span>`;
}

async function loadCustomers() {
  const q = document.getElementById("searchInput").value;
  const country = document.getElementById("countryFilter").value;
  const status = document.getElementById("statusFilter").value;
  const quality = document.getElementById("qualityFilter").value;
  const contact = document.getElementById("contactFilter").value;
  const sourceType = document.getElementById("sourceFilter").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (country) params.set("country", country);
  if (status) params.set("status", status);
  if (quality) params.set("quality", quality);
  if (contact) params.set("contact", contact);
  if (sourceType) params.set("sourceType", sourceType);
  const data = await api(`/api/customers?${params}`);
  state.customers = data.customers;
  renderCustomers(data.customers);
}

async function loadDashboardSearch() {
  const q = document.getElementById("dashboardSearchInput").value.trim();
  const summary = document.getElementById("dashboardSearchSummary");
  if (!q) {
    state.dashboardSearchCustomers = [];
    summary.textContent = "Type to search the full database.";
    renderCustomerRows([], "dashboardSearchRows", "Search results will appear here.");
    return;
  }
  const params = new URLSearchParams({ q });
  const data = await api(`/api/customers?${params}`);
  state.dashboardSearchCustomers = data.customers;
  summary.textContent = `${data.total} matching records. Showing ${data.customers.length}.`;
  renderCustomerRows(data.customers, "dashboardSearchRows", "No matching records.");
}

function renderCustomers(customers) {
  renderCustomerRows(customers, "customerRows", "No records yet. Import a clean Excel list or add a customer manually.");
}

function renderCustomerRows(customers, targetId, emptyMessage) {
  const body = document.getElementById(targetId);
  const rows = [];
  let lastCategory = "";
  for (const c of customers) {
    const category = c.listCategory || "Potential Buyer";
    if (category !== lastCategory) {
      rows.push(`<tr class="listSectionRow"><td colspan="8">${escapeHtml(category === "Miscellaneous" ? "Miscellaneous" : "Potential Buyers")}</td></tr>`);
      lastCategory = category;
    }
    rows.push(`
    <tr>
      <td><strong>${escapeHtml(c.company)}</strong><div class="muted">${escapeHtml(c.city || "")}</div></td>
      <td>${escapeHtml(c.country)}</td>
      <td>${escapeHtml(c.person)}<div class="muted">${escapeHtml(c.role || "")}</div></td>
      <td>${escapeHtml(c.mobile || c.phone || "")}</td>
      <td>${escapeHtml(c.email || "")}</td>
      <td><span class="badge">${escapeHtml(labelSource(c.sourceType || ""))}</span></td>
      <td class="${escapeHtml(qualityFor(c))}">${labelQuality(qualityFor(c))}</td>
      <td class="rowActions">
        <a class="button secondary" href="/api/export.vcf?id=${encodeURIComponent(c.id)}">VCF</a>
        <button class="button secondary" data-edit-customer="${escapeHtml(c.id)}">Edit</button>
        <button class="button secondary" data-move-misc="${escapeHtml(c.id)}">Move to misc</button>
      </td>
    </tr>
  `);
  }
  body.innerHTML = customers.length ? rows.join("") : `<tr><td colspan="8" class="muted">${escapeHtml(emptyMessage)}</td></tr>`;

  body.querySelectorAll("[data-edit-customer]").forEach((button) => {
    button.addEventListener("click", async () => {
      const customer = [...state.customers, ...state.dashboardSearchCustomers].find((c) => c.id === button.dataset.editCustomer);
      if (customer) openCustomerDialog(customer);
    });
  });

  body.querySelectorAll("[data-move-misc]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/customers/${button.dataset.moveMisc}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manualCategory: "miscellaneous" })
      });
      toast("Moved to misc");
      await refresh();
      if (state.activeView === "companyContacts") await loadCompanyContacts();
    });
  });
}

async function loadDuplicates() {
  const type = document.getElementById("duplicateTypeFilter").value;
  const data = await api(`/api/duplicates?type=${encodeURIComponent(type)}&limit=250`);
  const el = document.getElementById("duplicateGroups");
  document.getElementById("duplicateSummary").innerHTML = data.groups.length
    ? `<strong>${data.groups.length}</strong> duplicate groups loaded. Exact email/mobile matches are safest; company/country matches should be reviewed before merging.`
    : `No duplicate groups found for this match type.`;
  el.innerHTML = data.groups.length ? data.groups.map((group, index) => `
    <div class="dupeGroup" data-dupe-index="${index}">
      <div class="dupeHeader">
        <div>
          <strong>${escapeHtml(group.reason)}</strong>
          <div class="muted">${escapeHtml(group.key)} · ${group.customers.length} records</div>
        </div>
        <div class="dupeActions">
          <button class="button secondary" data-keep-separate-index="${index}">Keep separate</button>
          <button class="button mergeButton" data-merge-index="${index}">Merge selected</button>
        </div>
      </div>
      <div class="dupeTable">
        <div class="dupeTableHead">
          <span>Keep</span><span>Company</span><span>Contact</span><span>Source</span><span>Quality</span><span></span>
        </div>
        ${group.customers.map((c) => `
          <div class="dupeRecord ${c.id === group.recommendedPrimaryId ? "recommended" : ""}">
            <label><input type="radio" name="primary-${index}" value="${escapeHtml(c.id)}" ${c.id === group.recommendedPrimaryId ? "checked" : ""} /></label>
            <span><strong>${escapeHtml(c.company || "(No company)")}</strong><em>${escapeHtml([c.country, c.city].filter(Boolean).join(" · "))}</em></span>
            <span>${escapeHtml(c.person || "")}<em>${escapeHtml(c.email || c.mobile || c.phone || "No contact")}</em></span>
            <span>${escapeHtml(labelSource(c.sourceType || ""))}<em>trust ${escapeHtml(c.sourceTrust || "")} · score ${escapeHtml(c.duplicateScore || "")}</em></span>
            <span class="${escapeHtml(c.dataQuality || qualityFor(c))}">${escapeHtml(labelQuality(c.dataQuality || qualityFor(c)))}</span>
            <span><button class="button danger tinyButton" data-dupe-archive="${escapeHtml(c.id)}" type="button">Delete</button></span>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("") : `<span class="muted">No duplicate groups detected yet.</span>`;

  el.querySelectorAll("[data-merge-index]").forEach((button) => {
    button.addEventListener("click", async () => {
      const group = data.groups[Number(button.dataset.mergeIndex)];
      const ids = group.customers.map((c) => c.id);
      const primaryId = document.querySelector(`input[name="primary-${button.dataset.mergeIndex}"]:checked`)?.value || group.recommendedPrimaryId;
      if (ids.length < 2) return;
      await api("/api/duplicates/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, primaryId })
      });
      toast("Merged duplicate group");
      await refresh();
      await loadDuplicates();
    });
  });

  el.querySelectorAll("[data-keep-separate-index]").forEach((button) => {
    button.addEventListener("click", async () => {
      const group = data.groups[Number(button.dataset.keepSeparateIndex)];
      const ids = group.customers.map((c) => c.id);
      await api("/api/duplicates/keep-separate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, reason: "Valid separate contacts at same company" })
      });
      toast("Kept as separate contacts");
      await refresh();
      await loadDuplicates();
    });
  });

  el.querySelectorAll("[data-dupe-archive]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await fetch(`/api/customers/${button.dataset.dupeArchive}`, { method: "DELETE" });
      toast("Archived");
      await refresh();
      await loadDuplicates();
    });
  });
}

async function loadCompanyContacts() {
  const q = document.getElementById("companyContactSearch").value;
  const params = new URLSearchParams({ category: "miscellaneous" });
  if (q) params.set("q", q);
  const data = await api(`/api/customers?${params}`);
  document.getElementById("companyContactsSummary").innerHTML = data.total
    ? `<strong>${data.total}</strong> miscellaneous contacts loaded. These stay out of outreach exports.`
    : `No miscellaneous contacts match this filter.`;
  const el = document.getElementById("companyContactGroups");
  el.innerHTML = data.customers.length ? `
    <div class="contactGrid">
      ${data.customers.map((c) => `
        <div class="contactCard">
          <strong>${escapeHtml(c.company || "(No company)")}</strong>
          <span>${escapeHtml([c.country, c.city].filter(Boolean).join(" · "))}</span>
          <span>${escapeHtml(c.person || "(No person)")}</span>
          <span>${escapeHtml(c.role || "")}</span>
          <span>${escapeHtml(c.mobile || c.phone || "No phone")}</span>
          <span>${escapeHtml(c.email || "No email")}</span>
          <em>${escapeHtml(labelSource(c.sourceType || ""))} · ${escapeHtml(labelQuality(c.dataQuality || qualityFor(c)))}</em>
          <button class="button secondary contactArchiveBtn" data-contact-archive="${escapeHtml(c.id)}">Archive contact</button>
        </div>
      `).join("")}
    </div>
  ` : `<span class="muted">No miscellaneous contacts to show.</span>`;

  el.querySelectorAll("[data-contact-archive]").forEach((button) => {
    button.addEventListener("click", async () => {
      await fetch(`/api/customers/${button.dataset.contactArchive}`, { method: "DELETE" });
      toast("Contact archived");
      await refresh();
      await loadCompanyContacts();
    });
  });
}

async function loadResearch() {
  const q = document.getElementById("researchSearch").value;
  const sourceType = document.getElementById("researchSourceFilter").value;
  const params = new URLSearchParams({ quality: "research_needed", category: "buyer" });
  if (q) params.set("q", q);
  if (sourceType) params.set("sourceType", sourceType);
  const data = await api(`/api/customers?${params}`);
  document.getElementById("researchSummary").innerHTML = data.total
    ? `<strong>${data.total}</strong> research-needed records found. Showing ${data.customers.length}.`
    : `No research-needed records match this filter.`;
  renderResearchRows(data.customers);
}

function renderResearchRows(customers) {
  const el = document.getElementById("researchRows");
  el.innerHTML = customers.length ? customers.map((c) => `
    <form class="researchCard" data-research-id="${escapeHtml(c.id)}">
      <div class="researchTop">
        <strong>${escapeHtml(c.company || "(No company)")}</strong>
        <span class="badge">${escapeHtml(labelSource(c.sourceType || ""))}</span>
      </div>
      <div class="researchReason">${escapeHtml(researchReason(c))}</div>
      <div class="researchFields">
        <input name="company" value="${escapeAttr(c.company || "")}" placeholder="Company" />
        <input name="person" value="${escapeAttr(c.person || "")}" placeholder="Person" />
        <input name="country" value="${escapeAttr(c.country || "")}" placeholder="Country" />
        <input name="city" value="${escapeAttr(c.city || "")}" placeholder="City" />
        <input name="mobile" value="${escapeAttr(c.mobile || "")}" placeholder="Mobile / WhatsApp" />
        <input name="phone" value="${escapeAttr(c.phone || "")}" placeholder="Phone" />
        <input name="email" value="${escapeAttr(c.email || "")}" placeholder="Email" />
        <input name="website" value="${escapeAttr(c.website || "")}" placeholder="Website" />
      </div>
      <textarea name="notes" placeholder="Notes">${escapeHtml(c.notes || "")}</textarea>
      <div class="researchActions">
        <button class="button" type="submit">Save</button>
        <button class="button danger" type="button" data-research-delete="${escapeHtml(c.id)}">Delete</button>
      </div>
      <div class="muted">${escapeHtml([c.sourceFile, c.sourceSheet, c.sourceId].filter(Boolean).join(" · "))}</div>
    </form>
  `).join("") : `<span class="muted">No records to research.</span>`;

  el.querySelectorAll(".researchCard").forEach((form) => {
    form.addEventListener("submit", saveResearchRecord);
  });
  el.querySelectorAll("[data-research-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await fetch(`/api/customers/${button.dataset.researchDelete}`, { method: "DELETE" });
      toast("Deleted from active list");
      await refresh();
      await loadResearch();
    });
  });
}

async function saveResearchRecord(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  await api(`/api/customers/${form.dataset.researchId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(values)
  });
  toast("Saved");
  await refresh();
  await loadResearch();
}

function researchReason(c) {
  const reasons = [];
  if (!c.company) reasons.push("missing company");
  if (!c.country) reasons.push("missing country");
  if (!c.email && !c.mobile && !c.phone) reasons.push("no contact route");
  return reasons.length ? reasons.join(", ") : "needs review";
}

async function saveManualCustomer(event) {
  event.preventDefault();
  const form = document.getElementById("customerForm");
  const values = Object.fromEntries(new FormData(form).entries());
  if (!values.company) return;
  const isEdit = Boolean(state.editingCustomerId);
  await api(isEdit ? `/api/customers/${state.editingCustomerId}` : "/api/customers", {
    method: isEdit ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(isEdit ? values : { ...values, sourceType: "manual" })
  });
  form.reset();
  state.editingCustomerId = null;
  document.getElementById("customerDialog").close();
  toast(isEdit ? "Customer updated" : "Customer saved");
  await refresh();
  if (state.activeView === "companyContacts") await loadCompanyContacts();
}

async function importFile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const result = await api("/api/import", { method: "POST", body: data });
  toast(`Imported ${result.importedCount} records`);
  form.reset();
  await refresh();
}

async function uploadCard(event) {
  event?.preventDefault();
  if (state.cardUploadBusy) return;
  const form = event?.currentTarget || document.getElementById("cardForm");
  const data = new FormData(form);
  const file = data.get("file");
  if (!file || !file.size) {
    toast("Take a photo first");
    return;
  }
  const submitButton = form.querySelector("button[type='submit']");
  setBusyButton(submitButton, "Reading...");
  document.getElementById("cardFileName").textContent = "Photo captured. Uploading and reading...";
  showProcessing("Reading card", "Uploading the photo and reading the contact details...");
  state.cardUploadBusy = true;
  try {
    const result = await api("/api/cards/ocr?quick=1", { method: "POST", body: data });
    showOcrReview(result);
    if (result.aiStatus !== "skipped") hideProcessing();
    toast(result.aiStatus === "ok" || result.ocrStatus === "ok" ? "Card read" : "Card saved for review");
    form.reset();
    document.getElementById("cardFileName").textContent = "No card photo selected.";
  } catch (error) {
    hideProcessing();
    toast("Card could not be read");
    throw error;
  } finally {
    state.cardUploadBusy = false;
    setBusyButton(submitButton, "");
  }
}

async function uploadQuickCard(event) {
  event?.preventDefault();
  if (state.cardUploadBusy) return;
  const form = document.getElementById("quickCardForm");
  const data = new FormData(form);
  const file = data.get("file");
  if (!file || !file.size) {
    toast("Take a photo first");
    return;
  }
  const submitButton = document.getElementById("saveCardBtn");
  setBusyButton(submitButton, "Reading...");
  document.getElementById("quickCardFileName").textContent = "Photo captured. Uploading and reading...";
  showProcessing("Reading card", "Uploading the photo and reading the contact details...");
  state.cardUploadBusy = true;
  try {
    const result = await api("/api/cards/ocr?quick=1", { method: "POST", body: data });
    form.reset();
    document.getElementById("quickCardFileName").textContent = "No card photo selected.";
    document.getElementById("cardDialog").close();
    showOcrReview(result);
    if (result.aiStatus !== "skipped") hideProcessing();
    toast(result.aiStatus === "ok" || result.ocrStatus === "ok" ? "Card read" : "Card saved for review");
    switchView("cards");
  } catch (error) {
    hideProcessing();
    toast("Card could not be read");
    throw error;
  } finally {
    state.cardUploadBusy = false;
    setBusyButton(submitButton, "");
  }
}

function setBusyButton(button, label) {
  if (!button) return;
  if (label) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

async function loadAiStatus() {
  const el = document.getElementById("cardAiStatus");
  if (!el) return;
  try {
    const status = await api("/api/ai/status");
    if (status.aiStatus === "ready" && status.aiProvider === "openai") {
      el.textContent = `OpenAI card reader ready: ${status.aiModel}. Phone card photos will be read on this PC.`;
    } else if (status.aiStatus === "ready" && status.aiProvider === "gemini") {
      el.textContent = `Gemini card reader ready: ${status.aiModel}. Phone card photos will be read on this PC.`;
    } else if (status.aiStatus === "ready") {
      el.textContent = `Free local AI ready: ${status.aiModel}. Phone card photos will be read on this PC.`;
    } else if (status.aiStatus === "model_missing") {
      el.textContent = `Ollama is running, but ${status.aiModel} is not installed yet. Card photos will save for manual review.`;
    } else {
      el.textContent = `${status.message} Card photos will still save for manual review.`;
    }
  } catch {
    el.textContent = "Free local AI status could not be checked. Card photos will still save for manual review.";
  }
}

async function loadOutreachStatus() {
  const box = document.getElementById("outreachStatusBox");
  if (!box) return;
  try {
    const status = await api("/api/outreach/status");
    document.getElementById("oEligible").textContent = status.totals.eligibleBuyerEmailRecords;
    document.getElementById("oCountries").textContent = status.totals.eligibleCountries;
    document.getElementById("oMisc").textContent = status.totals.miscellaneousExcluded;
    document.getElementById("oSuppressed").textContent = status.totals.suppressedEmails;
    const connectedText = status.connected ? "Resend outreach account linked" : "Resend outreach account not linked";
    const sendText = status.sendingEnabled ? "campaign sending available" : "campaign sending locked";
    box.innerHTML = `
      <strong>${escapeHtml(connectedText)}</strong>
      <span>${escapeHtml(status.sender)} · ${escapeHtml(status.domain)} · ${escapeHtml(sendText)} · 5 minute gap</span>
    `;
    document.getElementById("outreachSafetyNote").textContent =
      "Only potential buyer records with email addresses are counted here. Miscellaneous contacts stay excluded. Every campaign sends one customer email every 5 minutes.";
    const countrySelect = document.getElementById("outreachCountry");
    const selected = countrySelect.value;
    countrySelect.innerHTML = `<option value="">Choose country</option>` + status.countries.map((country) => `<option value="${escapeAttr(country)}">${escapeHtml(country)}</option>`).join("");
    countrySelect.value = selected;
    updateOutreachSendButton();
    await loadOutreachCampaigns();
  } catch (error) {
    box.innerHTML = `<strong>Could not check outreach connection.</strong><span>${escapeHtml(error.message)}</span>`;
  }
}

async function previewOutreachList() {
  const country = document.getElementById("outreachCountry").value;
  const preview = document.getElementById("outreachPreview");
  const wrap = document.querySelector(".outreachPreviewTable");
  const rows = document.getElementById("outreachPreviewRows");
  if (!country) {
    preview.textContent = "Choose a country first.";
    wrap.classList.add("hidden");
    state.outreachPreviewTotal = 0;
    updateOutreachSendButton();
    return;
  }
  try {
    const data = await api(`/api/outreach/preview?country=${encodeURIComponent(country)}`);
    state.outreachPreviewTotal = data.total;
    preview.innerHTML = `<strong>${data.total}</strong> eligible buyer email${data.total === 1 ? "" : "s"} for ${escapeHtml(country)}. Showing first ${data.recipients.length}.`;
    rows.innerHTML = data.recipients.map((r) => `
      <tr>
        <td>${escapeHtml(r.company)}</td>
        <td>${escapeHtml(r.person)}</td>
        <td>${escapeHtml(r.country)}</td>
        <td>${escapeHtml(r.email)}</td>
      </tr>
    `).join("");
    wrap.classList.toggle("hidden", !data.recipients.length);
    updateOutreachSendButton();
  } catch (error) {
    preview.textContent = error.message;
    wrap.classList.add("hidden");
  }
}

async function draftOutreachEmail() {
  const country = document.getElementById("outreachCountry").value;
  if (!country) {
    toast("Choose country first");
    return;
  }
  try {
    showProcessing("Drafting email", "AI is preparing a short outreach email.");
    const draft = await api("/api/outreach/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country })
    });
    document.getElementById("outreachSubject").value = draft.subject || "";
    document.getElementById("outreachBody").value = draft.body || "";
    state.outreachTestPassed = false;
    updateOutreachSendButton();
    toast(`Draft ready (${draft.provider})`);
  } catch (error) {
    toast(`Draft failed: ${error.message}`);
  } finally {
    hideProcessing();
  }
}

async function sendOutreachTest() {
  const payload = outreachPayload();
  if (!payload.country || !payload.subject || !payload.body) {
    toast("Country, subject, and body are required");
    return;
  }
  if (!payload.testEmail) {
    toast("Enter your test email first");
    return;
  }
  try {
    showProcessing("Sending test", "Sending a test email before the real campaign.");
    const result = await api("/api/outreach/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    state.outreachTestPassed = true;
    updateOutreachSendButton();
    toast(`Test sent to ${result.to}`);
  } catch (error) {
    state.outreachTestPassed = false;
    updateOutreachSendButton();
    toast(`Test failed: ${error.message}`);
  } finally {
    hideProcessing();
  }
}

async function startOutreachCampaign() {
  const payload = outreachPayload();
  if (!state.outreachTestPassed) {
    toast("Send test email first");
    return;
  }
  if (!state.outreachPreviewTotal) await previewOutreachList();
  const total = state.outreachPreviewTotal;
  if (!total) {
    toast("No eligible emails for this country");
    return;
  }
  const hours = Math.ceil((Math.max(total - 1, 0) * 5) / 60);
  const ok = confirm(`Send ${total} emails to ${payload.country}? The app will send one email every 5 minutes. Approx time: ${hours || 1} hour(s).`);
  if (!ok) return;
  try {
    const result = await api("/api/outreach/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, confirmed: true })
    });
    state.outreachTestPassed = false;
    updateOutreachSendButton();
    toast(`Campaign queued: ${result.campaign.total} emails`);
    await loadOutreachCampaigns();
  } catch (error) {
    toast(`Campaign failed: ${error.message}`);
  }
}

async function loadOutreachCampaigns() {
  const el = document.getElementById("outreachCampaigns");
  if (!el) return;
  const data = await api("/api/outreach/campaigns");
  el.innerHTML = data.campaigns.length ? data.campaigns.map((c) => `
    <div class="campaignItem">
      <strong>${escapeHtml(c.country)} · ${escapeHtml(c.status)}</strong>
      <span>${c.sent}/${c.total} sent · ${c.failed} failed · ${c.skipped} skipped · ${c.queued} queued</span>
      <span>${c.nextSendAt ? `Next: ${escapeHtml(new Date(c.nextSendAt).toLocaleString())}` : "No pending send"}</span>
    </div>
  `).join("") : `<span class="muted">No campaigns queued yet.</span>`;
}

function outreachPayload() {
  return {
    country: document.getElementById("outreachCountry").value,
    testEmail: document.getElementById("outreachTestEmail").value,
    cc: document.getElementById("outreachCc").value,
    subject: document.getElementById("outreachSubject").value,
    body: document.getElementById("outreachBody").value
  };
}

function updateOutreachSendButton() {
  const button = document.getElementById("startOutreachBtn");
  if (!button) return;
  button.disabled = !state.outreachTestPassed || !document.getElementById("outreachCountry").value;
}

function showOcrReview(result) {
  const panel = document.getElementById("ocrReview");
  const form = document.getElementById("ocrCustomerForm");
  form.elements.sourcePhoto.value = result.path || "";
  const image = document.getElementById("ocrCardImage");
  if (result.path) {
    image.src = `/${result.path}`;
    image.classList.remove("hidden");
  } else {
    image.removeAttribute("src");
    image.classList.add("hidden");
  }
  fillOcrFields(result.extracted || {}, { onlyEmpty: false });
  if (result.ocrText && !form.elements.notes.value.includes(result.ocrText)) {
    form.elements.notes.value = [form.elements.notes.value, `OCR text:\n${result.ocrText}`].filter(Boolean).join("\n\n");
  }
  document.getElementById("ocrRawText").textContent = result.ocrText || result.aiText || result.message || "No text was read. You can still type the contact manually and save it.";
  const readerStatus = result.aiStatus === "ok"
    ? `AI read with ${result.aiModel || "local model"}`
    : result.aiStatus === "skipped"
      ? "Photo saved for quick manual review"
    : `AI status: ${result.aiStatus || "unknown"}`;
  document.getElementById("ocrStatus").textContent = result.aiStatus === "ok" || result.ocrStatus === "ok"
    ? `${readerStatus}. Please check and correct before saving.`
    : `${readerStatus}. Fill the fields from the card preview, then save.`;
  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  if (result.aiStatus === "skipped" && result.path) {
    autoFillCurrentCard({ manual: false });
  }
}

function fillOcrFields(extracted, { onlyEmpty = true } = {}) {
  const form = document.getElementById("ocrCustomerForm");
  for (const field of ["company", "person", "role", "country", "city", "mobile", "phone", "email", "website", "address", "notes"]) {
    const value = extracted[field] || "";
    if (!value || !form.elements[field]) continue;
    if (!onlyEmpty || !form.elements[field].value.trim()) form.elements[field].value = value;
  }
}

async function autoFillCurrentCard({ manual = false } = {}) {
  const form = document.getElementById("ocrCustomerForm");
  const sourcePhoto = form.elements.sourcePhoto.value;
  const button = document.getElementById("autoFillCardBtn");
  if (!sourcePhoto) return;
  setBusyButton(button, "Auto-filling...");
  showProcessing("Reading card", "Gemini is reading the card details...");
  document.getElementById("ocrStatus").textContent = "Photo saved. Gemini is trying to fill the fields; you can type while it works.";
  try {
    const result = await api("/api/cards/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: sourcePhoto })
    });
    fillOcrFields(result.extracted || {}, { onlyEmpty: true });
    document.getElementById("ocrRawText").textContent = result.aiText || result.message || "AI could not read clear text from this card.";
    const hasFields = Object.values(result.extracted || {}).some(Boolean);
    document.getElementById("ocrStatus").textContent = hasFields
      ? "AI filled what it could read. Please check and correct before saving."
      : "AI could not read this card clearly. Please fill it manually from the preview.";
    if (manual || hasFields) toast(hasFields ? "Fields auto-filled" : "AI could not read this card");
  } catch {
    document.getElementById("ocrStatus").textContent = "AI reader did not finish. The photo is saved, so please fill from the preview.";
    if (manual) toast("AI reader did not finish");
  } finally {
    setBusyButton(button, "");
    hideProcessing();
  }
}

function saveCurrentCardToPhone() {
  const form = document.getElementById("ocrCustomerForm");
  const values = Object.fromEntries(new FormData(form).entries());
  if (!values.company && !values.person && !values.mobile && !values.phone && !values.email) {
    toast("Fill contact details first");
    return;
  }
  const name = values.person || values.company || "Card contact";
  const fileName = `${safeFileName(name)}.vcf`;
  const vcf = buildVcf(values);
  const blob = new Blob([vcf], { type: "text/vcard;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
  toast(`Phone contact saved as ${fileName}`);
}

function buildVcf(values) {
  const fullName = values.person || values.company || "Card contact";
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${vcfEscape(fullName)}`,
    values.company ? `ORG:${vcfEscape(values.company)}` : "",
    values.role ? `TITLE:${vcfEscape(values.role)}` : "",
    ...splitContactValues(values.mobile).map((value) => `TEL;TYPE=CELL:${vcfEscape(value)}`),
    ...splitContactValues(values.phone).map((value) => `TEL;TYPE=WORK:${vcfEscape(value)}`),
    ...splitContactValues(values.email).map((value) => `EMAIL;TYPE=INTERNET:${vcfEscape(value)}`),
    values.website ? `URL:${vcfEscape(splitContactValues(values.website)[0] || values.website)}` : "",
    values.address ? `ADR;TYPE=WORK:;;${vcfEscape(values.address)};${vcfEscape(values.city || "")};;${vcfEscape(values.country || "")};` : "",
    values.notes ? `NOTE:${vcfEscape(values.notes)}` : "",
    "END:VCARD"
  ].filter(Boolean).join("\r\n");
}

function splitContactValues(value) {
  return String(value || "").split(/[;,]\s*/).map((item) => item.trim()).filter(Boolean);
}

function vcfEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function safeFileName(value) {
  return String(value || "Card contact").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Card contact";
}

function showProcessing(title, text) {
  document.getElementById("processingTitle").textContent = title || "Processing";
  document.getElementById("processingText").textContent = text || "Please wait...";
  document.getElementById("processingOverlay").classList.remove("hidden");
}

function hideProcessing() {
  document.getElementById("processingOverlay").classList.add("hidden");
}

async function saveOcrCustomer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  if (!values.company && !values.person && !values.mobile && !values.email) return;
  await api("/api/customers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...values, sourceType: "card_ocr" })
  });
  form.reset();
  discardOcrReview();
  toast("Card contact saved");
  await refresh();
}

function discardOcrReview() {
  document.getElementById("ocrCustomerForm").reset();
  document.getElementById("ocrRawText").textContent = "";
  document.getElementById("ocrStatus").textContent = "";
  document.getElementById("ocrReview").classList.add("hidden");
}

function statusFor(c) {
  if (!c.email && !c.mobile && !c.phone) return "incomplete";
  if (!c.email) return "missing_email";
  if (!c.mobile) return "missing_mobile";
  if ((c.sourceTrust || 0) < 60) return "needs_review";
  return "ready";
}

function qualityFor(c) {
  if (!c.company || !c.country) return "research_needed";
  if (!c.email && !c.mobile && !c.phone) return "research_needed";
  if ((c.sourceTrust || 0) < 60) return "review";
  if (!c.email) return "phone_only";
  if (!c.mobile && !c.phone) return "email_only";
  return "clean";
}

function labelQuality(quality) {
  return {
    clean: "Clean",
    phone_only: "Phone only",
    email_only: "Email only",
    research_needed: "Research needed",
    review: "Review"
  }[quality] || quality;
}

function labelSource(source) {
  return {
    archive_buyer_list: "Archive list",
    card_master: "Card master",
    verified_country_workbook: "Verified workbook",
    clean_excel: "Clean Excel",
    manual: "Manual",
    card_ocr: "Card OCR",
    internet_research: "Internet research",
    ai_suggestion: "AI suggestion"
  }[source] || source;
}

function labelStatus(status) {
  return {
    ready: "Ready",
    missing_email: "Missing email",
    missing_mobile: "Missing mobile",
    incomplete: "Incomplete",
    needs_review: "Needs review"
  }[status] || status;
}

async function api(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }
  return response.json();
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

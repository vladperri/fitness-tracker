// Одноразовий імпорт записів з claude.ai: export.json + фото з папки images.
import { h, str, put, makeThumb } from "./util.js";
import { S, saveFile, saveRecord, setStatus } from "./data.js";
import { backBtn } from "./render.js";

let running = false;

export function renderImport(box) {
  document.title = "Імпорт · Медкартка";
  if (running) return;
  const input = h("input", { type: "file", id: "imp-files", multiple: true, accept: ".json,application/json,image/*" });
  const log = h("div", { class: "log", id: "imp-log", hidden: true, "aria-live": "polite" });
  const btn = h("button", { class: "btn", type: "button", id: "imp-run", disabled: true, text: "Імпортувати" });
  const msg = h("p", { class: "src", id: "imp-msg" });
  input.addEventListener("change", () => {
    const files = [...input.files];
    const hasJson = files.some((f) => f.name === "export.json");
    const imgs = files.filter((f) => f.type.startsWith("image/")).length;
    msg.textContent = hasJson ? `Вибрано: export.json і ${imgs} фото.` : "Серед вибраних файлів немає export.json.";
    btn.disabled = !hasJson;
  });
  btn.addEventListener("click", () => run([...input.files], btn, log, msg));
  put(box, 
    backBtn(),
    h("header", { class: "rec-head" }, h("h1", { text: "Імпорт записів з claude.ai" }),
      h("span", { class: "src", text: "Один раз переносить записи, план лікування і фото з попередньої версії медкартки." })),
    h("div", { class: "panel" },
      h("ol", { style: "margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px" },
        h("li", { text: "Розпакуй архів експорту на комп'ютері." }),
        h("li", { text: "Натисни «Вибрати файли» й виділи export.json разом з усіма фото з папки images (Cmd/Ctrl + A)." }),
        h("li", { text: "Натисни «Імпортувати». Повторний імпорт перезапише ті самі записи, дублікатів не буде." })),
      h("div", { class: "field" }, h("label", { for: "imp-files", text: "Файли експорту" }), input),
      msg,
      h("div", { class: "actions" }, btn)),
    log);
}

async function run(files, btn, log, msg) {
  running = true;
  btn.disabled = true;
  log.hidden = false;
  log.textContent = "";
  const say = (t) => { log.textContent += `${t}\n`; log.scrollTop = log.scrollHeight; };
  try {
    const jsonFile = files.find((f) => f.name === "export.json");
    const data = JSON.parse(await jsonFile.text());
    const images = new Map(files.filter((f) => f.type.startsWith("image/")).map((f) => [f.name, f]));
    let nImg = 0;
    let missing = 0;
    for (const rec of data.records || []) {
      const id = str(rec.id).replace(/[^A-Za-z0-9_-]/g, "");
      if (!id) continue;
      say(`Запис «${rec.title}»: ${rec.gallery?.length || 0} фото`);
      const gallery = [];
      for (const [i, g] of (rec.gallery || []).entries()) {
        const file = images.get(g.file);
        if (!file) { missing++; say(`  немає файлу ${g.file} — пропускаю`); continue; }
        // Стабільний id: повторний імпорт перезапише ті самі файли, а не додасть копії.
        const fileId = await saveFile(
          { blob: file, type: file.type || "image/jpeg", kind: "image", thumb: await makeThumb(file) },
          { name: g.file, id: `imp-${id}-${i}` });
        gallery.push({ file: fileId, caption: str(g.caption), kind: "image" });
        nImg++;
      }
      const { id: _drop, gallery: _g, ...rest } = rec;
      await saveRecord(id, { ...rest, gallery }, { isNew: true });
      say("  збережено");
    }
    if (data.status) {
      await setStatus(data.status);
      say("План лікування збережено");
    }
    msg.textContent = `Готово: ${data.records?.length || 0} записи, ${nImg} фото${missing ? `, ${missing} фото не знайдено` : ""}.`;
    say(msg.textContent);
  } catch (e) {
    msg.textContent = "Імпорт зупинився з помилкою. Перевір файли й спробуй ще раз.";
    say(`Помилка: ${e.message || e}`);
  } finally {
    running = false;
    btn.disabled = false;
  }
}

export const isImporting = () => running;
export { S };

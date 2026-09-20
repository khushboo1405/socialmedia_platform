/* Commons frontend — vanilla JS single-page app with hash routing. */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const app = $("#app");

const state = { token: localStorage.getItem("token"), me: null };
const PAGE_SIZE = 15;

/* ------------------------------------------------------------ helpers */
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

async function api(path, { method = "GET", body, form } = {}) {
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let payload;
  if (form) payload = form;
  else if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const data = await res.json().catch(() => null);
  if (res.status === 401 && state.token) {
    clearSession();
    renderAuth();
  }
  if (!res.ok) {
    const d = data?.detail;
    throw new Error(Array.isArray(d) ? d[0]?.msg || "Check your input." : d || "Something went wrong. Try again.");
  }
  return data;
}

function saveSession(token, user) {
  state.token = token;
  state.me = user;
  localStorage.setItem("token", token);
}
function clearSession() {
  state.token = null;
  state.me = null;
  localStorage.removeItem("token");
}

const initials = (name) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";

const avatar = (u, size = "") =>
  `<span class="avatar ${size}" style="background:${esc(u.avatar_color)}" aria-hidden="true">${esc(initials(u.display_name))}</span>`;

const ICONS = {
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.5-9.1C1.1 8.5 3 5 6.4 5c2 0 3.6 1.1 4.6 2.6h2C14 6.1 15.6 5 17.6 5 21 5 22.9 8.5 21.5 11.9 19.5 16.4 12 21 12 21z"/></svg>',
  comment: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-5.5A8 8 0 1 1 21 12z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
};

/* -------------------------------------------------------------- auth */
function renderAuth(mode = "login") {
  const isLogin = mode === "login";
  app.innerHTML = `
    <div class="auth">
      <section class="auth-hero">
        <div class="wordmark">commons<span class="dot"></span></div>
        <p>A small place to post, follow, and talk.</p>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <h1>${isLogin ? "Log in" : "Create your account"}</h1>
          <form id="auth-form" novalidate>
            ${isLogin ? "" : `<label class="field">Display name<input type="text" name="display_name" maxlength="40" autocomplete="name"></label>`}
            <label class="field">Username<input type="text" name="username" required autocomplete="username" autocapitalize="none"></label>
            <label class="field">Password<input type="password" name="password" required autocomplete="${isLogin ? "current-password" : "new-password"}"></label>
            <p class="auth-error" id="auth-error" role="alert"></p>
            <button class="btn block" type="submit">${isLogin ? "Log in" : "Create account"}</button>
          </form>
          <p class="auth-switch">${isLogin ? "New here?" : "Already have an account?"}
            <button class="link" id="auth-toggle" type="button">${isLogin ? "Create an account" : "Log in"}</button></p>
        </div>
      </section>
    </div>`;

  $("#auth-toggle").onclick = () => renderAuth(isLogin ? "register" : "login");
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const btn = $("button[type=submit]", e.target);
    btn.disabled = true;
    try {
      const data = await api(isLogin ? "/auth/login" : "/auth/register", { method: "POST", body: fd });
      saveSession(data.token, data.user);
      location.hash = "#/";
      boot();
    } catch (err) {
      $("#auth-error").textContent = err.message;
      btn.disabled = false;
    }
  };
}

/* ------------------------------------------------------------- shell */
function renderShell() {
  const me = state.me;
  app.innerHTML = `
    <div class="shell">
      <aside class="nav">
        <a class="brand" href="#/">commons<span class="dot"></span></a>
        <nav aria-label="Main">
          <a href="#/" data-nav="home">Home</a>
          <a href="#/explore" data-nav="explore">Explore</a>
          <a href="#/u/${esc(me.username)}" data-nav="me">Profile</a>
        </nav>
        <div class="nav-me">
          ${avatar(me, "sm")}
          <div class="who"><b>${esc(me.display_name)}</b><span>@${esc(me.username)}</span></div>
          <button class="btn ghost small" data-action="logout">Log out</button>
        </div>
      </aside>
      <div>
        <div class="mobile-top"><a class="brand" href="#/">commons<span class="dot"></span></a>
          <button class="btn ghost small" data-action="logout">Log out</button></div>
        <main id="main"></main>
      </div>
      <aside class="rail" id="rail"></aside>
    </div>`;
  loadRail();
}

async function loadRail() {
  const rail = $("#rail");
  if (!rail) return;
  try {
    const people = await api("/users/suggestions");
    rail.innerHTML = `<div class="rail-card"><h2>People to follow</h2>${
      people.length
        ? people.map((p) => personHTML({ ...p, is_following: false })).join("")
        : '<p class="muted">You\'re following everyone. Check back as more people join.</p>'
    }</div>`;
  } catch {
    rail.innerHTML = "";
  }
}

function personHTML(p) {
  return `<div class="person">
    <a href="#/u/${esc(p.username)}">${avatar(p, "sm")}</a>
    <a class="who" href="#/u/${esc(p.username)}"><b>${esc(p.display_name)}</b><span>@${esc(p.username)}</span></a>
    ${p.is_me ? "" : followBtn(p.username, p.is_following, "small")}
  </div>`;
}

const followBtn = (username, following, extra = "") =>
  `<button class="btn ${following ? "ghost" : ""} ${extra}" data-action="follow" data-user="${esc(username)}">${following ? "Following" : "Follow"}</button>`;

/* ------------------------------------------------------------- posts */
function postHTML(p) {
  const mine = p.username === state.me.username;
  return `<article class="post" data-id="${p.id}">
    <a href="#/u/${esc(p.username)}">${avatar(p)}</a>
    <div class="post-body">
      <div class="post-head">
        <a class="name" href="#/u/${esc(p.username)}">${esc(p.display_name)}</a>
        <span class="handle">@${esc(p.username)}</span>
        <time datetime="${esc(p.created_at)}">${timeAgo(p.created_at)}</time>
        ${mine ? `<button class="del" data-action="delete" aria-label="Delete post">${ICONS.trash}</button>` : ""}
      </div>
      ${p.content ? `<p class="text">${esc(p.content)}</p>` : ""}
      ${p.image_url ? `<img class="media" src="${esc(p.image_url)}" alt="Photo posted by ${esc(p.display_name)}" loading="lazy">` : ""}
      <div class="post-foot">
        <button class="act like ${p.liked ? "on" : ""}" data-action="like" aria-pressed="${p.liked}" aria-label="Like">${ICONS.heart}<span>${p.like_count}</span></button>
        <button class="act" data-action="comments" aria-label="Comments">${ICONS.comment}<span>${p.comment_count}</span></button>
      </div>
      <section class="comments" hidden></section>
    </div>
  </article>`;
}

async function mountFeed(params, emptyHTML) {
  const feed = $("#feed");
  const more = $("#more");
  let before = null;

  async function load() {
    const q = new URLSearchParams({ ...params, limit: PAGE_SIZE });
    if (before) q.set("before", before);
    const posts = await api(`/posts?${q}`);
    if (!before && !posts.length) feed.innerHTML = `<div class="empty">${emptyHTML}</div>`;
    else feed.insertAdjacentHTML("beforeend", posts.map(postHTML).join(""));
    if (posts.length) before = posts[posts.length - 1].id;
    more.innerHTML = posts.length === PAGE_SIZE ? '<button class="btn ghost" id="load-more">Load more</button>' : "";
    $("#load-more")?.addEventListener("click", () => load().catch((e) => toast(e.message)));
  }
  try {
    await load();
  } catch (e) {
    feed.innerHTML = `<div class="empty"><b>Couldn't load posts</b>${esc(e.message)}</div>`;
  }
}

function composerHTML() {
  return `<form class="composer" id="composer">
    ${avatar(state.me)}
    <div class="composer-main">
      <textarea name="content" rows="2" maxlength="500" placeholder="What's on your mind?" aria-label="Write a post"></textarea>
      <div class="preview" id="preview" hidden>
        <img alt="Selected photo preview"><button type="button" class="link" id="clear-img">Remove photo</button>
      </div>
      <div class="composer-bar">
        <label class="btn ghost small">Add photo<input type="file" name="image" accept="image/jpeg,image/png,image/gif,image/webp" hidden></label>
        <span class="count" id="count">500</span>
        <button class="btn" type="submit">Post</button>
      </div>
    </div>
  </form>`;
}

function bindComposer() {
  const form = $("#composer");
  const ta = $("textarea", form);
  const file = $("input[type=file]", form);
  const count = $("#count");
  const preview = $("#preview");

  const autosize = () => {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
    const left = 500 - ta.value.length;
    count.textContent = left;
    count.classList.toggle("warn", left < 40);
  };
  ta.addEventListener("input", autosize);

  file.addEventListener("change", () => {
    const f = file.files[0];
    if (!f) return;
    $("img", preview).src = URL.createObjectURL(f);
    preview.hidden = false;
  });
  $("#clear-img").onclick = () => {
    file.value = "";
    preview.hidden = true;
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    if (!file.files[0]) fd.delete("image");
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    try {
      const post = await api("/posts", { method: "POST", form: fd });
      $("#feed .empty")?.remove();
      $("#feed").insertAdjacentHTML("afterbegin", postHTML(post));
      form.reset();
      preview.hidden = true;
      autosize();
      toast("Posted");
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  };
}

/* ------------------------------------------------------------- views */
function homeView() {
  $("#main").innerHTML = `<h1 class="page-title">Home</h1>${composerHTML()}<div class="feed" id="feed"></div><div class="more" id="more"></div>`;
  bindComposer();
  mountFeed(
    { scope: "feed" },
    "<b>Your feed is quiet</b>Write your first post above, or follow people from Explore."
  );
}

async function exploreView(query) {
  const q = new URLSearchParams(query).get("q") || "";
  $("#main").innerHTML = `
    <h1 class="page-title">Explore</h1>
    <form class="search" id="search" role="search">
      <input type="text" name="q" value="${esc(q)}" placeholder="Search people and posts" aria-label="Search people and posts">
      <button class="btn" type="submit">Search</button>
    </form>
    <div id="people"></div>
    <div class="feed" id="feed"></div><div class="more" id="more"></div>`;
  $("#search").onsubmit = (e) => {
    e.preventDefault();
    const v = new FormData(e.target).get("q").trim();
    location.hash = v ? `#/explore?q=${encodeURIComponent(v)}` : "#/explore";
  };
  if (q) {
    try {
      const people = await api(`/users?q=${encodeURIComponent(q)}`);
      if (people.length) $("#people").innerHTML = `<div class="results">${people.map(personHTML).join("")}</div>`;
    } catch {}
  }
  mountFeed(
    q ? { scope: "explore", q } : { scope: "explore" },
    q ? `<b>No posts match “${esc(q)}”</b>Try a different word.` : "<b>Nothing here yet</b>Be the first to post."
  );
}

async function profileView(username) {
  const main = $("#main");
  main.innerHTML = "";
  let u;
  try {
    u = await api(`/users/${encodeURIComponent(username)}`);
  } catch (e) {
    main.innerHTML = `<div class="empty"><b>Profile not found</b>${esc(e.message)}</div>`;
    return;
  }
  main.innerHTML = `
    <section class="profile-head" id="profile-head">
      <div class="profile-top">
        ${avatar(u, "lg")}
        <div class="info"><h1>${esc(u.display_name)}</h1><span class="muted">@${esc(u.username)}</span></div>
        ${u.is_me ? '<button class="btn ghost small" id="edit-toggle">Edit profile</button>' : followBtn(u.username, u.is_following)}
      </div>
      ${u.bio ? `<p class="profile-bio">${esc(u.bio)}</p>` : u.is_me ? '<p class="muted">Add a short bio so people know who you are.</p>' : ""}
      <div class="stats">
        <span><b>${u.post_count}</b> posts</span>
        <span><b id="followers-count">${u.followers}</b> followers</span>
        <span><b>${u.following}</b> following</span>
      </div>
      <form class="edit-form" id="edit-form" hidden>
        <label class="field">Display name<input type="text" name="display_name" maxlength="40" value="${esc(u.display_name)}"></label>
        <label class="field">Bio<textarea name="bio" rows="3" maxlength="160">${esc(u.bio)}</textarea></label>
        <div class="row"><button class="btn small" type="submit">Save changes</button>
          <button class="btn ghost small" type="button" id="edit-cancel">Cancel</button></div>
      </form>
    </section>
    <div class="feed" id="feed"></div><div class="more" id="more"></div>`;

  if (u.is_me) {
    $("#edit-toggle").onclick = () => ($("#edit-form").hidden = !$("#edit-form").hidden);
    $("#edit-cancel").onclick = () => ($("#edit-form").hidden = true);
    $("#edit-form").onsubmit = async (e) => {
      e.preventDefault();
      try {
        state.me = { ...state.me, ...(await api("/me", { method: "PUT", body: Object.fromEntries(new FormData(e.target)) })) };
        renderShell();
        route();
        toast("Profile saved");
      } catch (err) {
        toast(err.message);
      }
    };
  }
  mountFeed(
    { scope: "user", username: u.username },
    u.is_me ? "<b>You haven't posted yet</b>Head to Home and share something." : `<b>No posts yet</b>${esc(u.display_name)} hasn't posted anything.`
  );
}

/* ------------------------------------------------------------ router */
function route() {
  const [path, query = ""] = (location.hash.slice(1) || "/").split("?");
  const main = $("#main");
  if (!main) return;
  $$("[data-nav]").forEach((a) => a.classList.remove("active"));
  let m;
  if ((m = path.match(/^\/u\/([^/]+)$/))) {
    const name = decodeURIComponent(m[1]);
    if (name === state.me.username) $('[data-nav="me"]').classList.add("active");
    profileView(name);
  } else if (path === "/explore") {
    $('[data-nav="explore"]').classList.add("active");
    exploreView(query);
  } else {
    $('[data-nav="home"]').classList.add("active");
    homeView();
  }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => state.me && route());

/* ------------------------------------------------------ click actions */
function commentHTML(c) {
  return `<div class="comment">${avatar(c, "sm")}<div>
    <div class="meta"><b>${esc(c.display_name)}</b> @${esc(c.username)} · ${timeAgo(c.created_at)}</div>
    <p>${esc(c.content)}</p></div></div>`;
}

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const post = el.closest(".post");
  try {
    if (action === "logout") {
      await api("/auth/logout", { method: "POST" }).catch(() => {});
      clearSession();
      renderAuth();
    }

    if (action === "like") {
      const r = await api(`/posts/${post.dataset.id}/like`, { method: "POST" });
      el.classList.toggle("on", r.liked);
      el.setAttribute("aria-pressed", r.liked);
      $("span", el).textContent = r.like_count;
    }

    if (action === "delete") {
      if (!confirm("Delete this post? This can't be undone.")) return;
      await api(`/posts/${post.dataset.id}`, { method: "DELETE" });
      post.remove();
      toast("Post deleted");
    }

    if (action === "follow") {
      const r = await api(`/users/${encodeURIComponent(el.dataset.user)}/follow`, { method: "POST" });
      $$(`[data-action="follow"][data-user="${CSS.escape(el.dataset.user)}"]`).forEach((b) => {
        b.textContent = r.following ? "Following" : "Follow";
        b.classList.toggle("ghost", r.following);
      });
      const fc = $("#followers-count");
      if (fc && location.hash.toLowerCase().endsWith(`/u/${el.dataset.user}`)) fc.textContent = r.followers;
    }

    if (action === "comments") {
      const box = $(".comments", post);
      if (!box.hidden) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      box.innerHTML = '<p class="muted">Loading…</p>';
      const list = await api(`/posts/${post.dataset.id}/comments`);
      box.innerHTML = `<div class="comment-list">${list.map(commentHTML).join("")}</div>
        <form class="comment-form"><input type="text" name="content" maxlength="300" placeholder="Add a comment" aria-label="Add a comment" required>
        <button class="btn small" type="submit">Reply</button></form>`;
      $(".comment-form input", box).focus();
    }
  } catch (err) {
    toast(err.message);
  }
});

document.addEventListener("submit", async (e) => {
  if (!e.target.matches(".comment-form")) return;
  e.preventDefault();
  const post = e.target.closest(".post");
  const input = $("input", e.target);
  try {
    const c = await api(`/posts/${post.dataset.id}/comments`, { method: "POST", body: { content: input.value } });
    $(".comment-list", post).insertAdjacentHTML("beforeend", commentHTML(c));
    const counter = $('[data-action="comments"] span', post);
    counter.textContent = Number(counter.textContent) + 1;
    input.value = "";
  } catch (err) {
    toast(err.message);
  }
});

/* -------------------------------------------------------------- boot */
async function boot() {
  if (!state.token) return renderAuth();
  try {
    state.me = await api("/me");
  } catch {
    clearSession();
    return renderAuth();
  }
  renderShell();
  route();
}
boot();

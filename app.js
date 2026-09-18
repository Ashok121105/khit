const defaultUpdates = [
  {title:"Welcome to KHIT Family",category:"Portal",description:"The KHIT Family digital portal prototype is ready for demonstration.",date:"18 Sep 2026"},
  {title:"Engineering Day Highlights",category:"Event",description:"College events, photos and videos can be published from the admin dashboard.",date:"18 Sep 2026"},
  {title:"College Updates",category:"Announcement",description:"Future official notices can be targeted to all students, a branch, year, section or selected users.",date:"18 Sep 2026"}
];

let updates = JSON.parse(localStorage.getItem("khit_updates") || "null") || defaultUpdates;

function renderUpdates(){
  const grid=document.getElementById("updatesGrid");
  document.getElementById("updateCount").textContent=updates.length;
  grid.innerHTML=updates.slice(0,6).map(u=>`
    <article class="update-card">
      <span class="tag">${escapeHtml(u.category || "UPDATE")}</span>
      <h3>${escapeHtml(u.title)}</h3>
      <p>${escapeHtml(u.description || "")}</p>
      <small>${escapeHtml(u.date || "")}</small>
    </article>`).join("");
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function toggleNav(){document.getElementById("nav").classList.toggle("open")}
function openLogin(role="student"){
  document.getElementById("loginModal").classList.add("show");
  document.getElementById("role").value=role;
  document.getElementById("loginTitle").textContent=role[0].toUpperCase()+role.slice(1)+" Login";
  document.getElementById("loginMsg").textContent="";
}
function closeLogin(){document.getElementById("loginModal").classList.remove("show")}
function login(){
  const role=document.getElementById("role").value;
  const id=document.getElementById("userId").value.trim();
  const pass=document.getElementById("password").value.trim();
  if(!id || !pass){document.getElementById("loginMsg").textContent="Please enter User ID and Password.";return}
  closeLogin(); openDashboard(role,id);
}
function openDashboard(role,id){
  document.getElementById("dashboardModal").classList.add("show");
  document.getElementById("dashRole").textContent=role.toUpperCase();
  document.getElementById("dashTitle").textContent=role==="admin"?"Admin Dashboard":role==="faculty"?"Faculty Dashboard":"Student Dashboard";
  const content=document.getElementById("dashboardContent");
  if(role==="student") content.innerHTML=studentDash(id);
  else if(role==="faculty") content.innerHTML=facultyDash(id);
  else content.innerHTML=adminDash();
}
function closeDashboard(){document.getElementById("dashboardModal").classList.remove("show")}
function studentDash(id){return `<div class="demo-note">Demo mode: official college data is not connected yet. Student information will later come from authorized college data.</div><div class="dash-grid">
${["My Profile","Digital Student ID / QR","Academics","Attendance","Exams & Results","Fees","Bus","Study Materials","Assignments","Activities & Events","Placements","Internships","Certificates / Documents","Leave Request","Achievements","Notifications","Help Desk","Feedback"].map(x=>`<div class="dash-card"><h3>${x}</h3><p>Available in the portal module.</p></div>`).join("")}</div>`}
function facultyDash(id){return `<div class="demo-note">Demo mode: faculty records and assigned classes will be supplied by the college during official integration.</div><div class="dash-grid">
${["My Profile","Digital Faculty ID","My Students","My Subjects","Timetable","Attendance","Marks","Study Materials","Assignments","Class Diary","Syllabus Tracking","Student Performance","Announcements","Leave","Documents","Notifications","Help Desk","Achievements & Professional Links"].map(x=>`<div class="dash-card"><h3>${x}</h3><p>Available in the faculty portal.</p></div>`).join("")}</div>`}
function adminDash(){return `<div class="demo-note">Admin is the content/data management area. This prototype uses browser storage. Later it can be connected to Firebase/database with authorized college data.</div>
<div class="admin-actions">
<button onclick="addDemoUpdate()">+ Add Demo Update</button>
<button onclick="addDemoVideo()"> Add Video Update</button>
<button onclick="addDemoPhoto()"> Add Photo Update</button>
<button onclick="clearDemo()">Clear Demo Updates</button>
</div>
<div class="dash-grid">${["Students","Faculty","Departments","Academic Years","Fees","Fee Reimbursement","Bus & Routes","Attendance","Marks & Results","Timetable","Exams","Assignments","Study Materials","Placements","Internships","Events & Activities","Notices & Notifications","Photos & Videos","Documents","Reports","Website Content","Import College Data"].map(x=>`<div class="dash-card"><h3>${x}</h3><p>Admin management module.</p></div>`).join("")}</div>`}
function addDemoUpdate(){updates.unshift({title:"New College Announcement",category:"Announcement",description:"This is a demo update. Replace it with official college content later.",date:new Date().toLocaleDateString("en-IN")});saveAndRender();alert("Demo update added.")}
function addDemoVideo(){updates.unshift({title:"College Video Update",category:"Video",description:"Demo video entry. The production version can store an authorized video/link and thumbnail.",date:new Date().toLocaleDateString("en-IN")});saveAndRender();alert("Demo video update added.")}
function addDemoPhoto(){updates.unshift({title:"College Photo Gallery Update",category:"Photo",description:"Demo photo entry. The production version can upload authorized images to storage.",date:new Date().toLocaleDateString("en-IN")});saveAndRender();alert("Demo photo update added.")}
function clearDemo(){localStorage.removeItem("khit_updates");updates=defaultUpdates.slice();saveAndRender();alert("Demo updates reset.")}
function saveAndRender(){localStorage.setItem("khit_updates",JSON.stringify(updates));renderUpdates()}
function showAllUpdates(){document.getElementById("updates").scrollIntoView({behavior:"smooth"})}
document.getElementById("year").textContent=new Date().getFullYear();
renderUpdates();

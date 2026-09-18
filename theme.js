(function () {
    const savedTheme = localStorage.getItem("khit_theme") || "light";

    function applyTheme(theme) {
        const selectedTheme = theme === "dark" ? "dark" : "light";
        document.documentElement.dataset.theme = selectedTheme;
        document.body.classList.toggle("theme-dark", selectedTheme === "dark");
    }

    window.applyKhitTheme = applyTheme;
    applyTheme(savedTheme);
})();

document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('appleBtn');
    const resultBox = document.getElementById('resultBox');

    button.addEventListener('click', () => {
        resultBox.textContent = ' Успішно: середовище налаштовано, скрипти виконуються бездоганно.';
    });
});
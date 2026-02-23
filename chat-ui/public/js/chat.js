async function sendMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value;
    if(!msg) return;
    
    appendMsg('User', msg);
    input.value = '';

    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ prompt: msg })
    });
    const data = await response.json();
    appendMsg('AI', data.answer || '답변을 가져오지 못했습니다.');
}

function appendMsg(sender, text) {
    const win = document.getElementById('chat-window');
    const div = document.createElement('div');
    div.innerHTML = `<b>${sender}:</b> ${text}`;
    win.appendChild(div);
}

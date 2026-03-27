import * as vscode from 'vscode';

interface Dictionary {
    [key: string]: string;
}

const en: Dictionary = {
    'connect.first': 'Connect to a server first.',
    'new.file': 'New Remote File',
    'create.file.in': 'Create file in {0}',
    'filename.txt': 'filename.txt',
    'file.required': 'File name is required.',
    'file.relative': 'Use a relative file name.',
    'new.folder': 'New Remote Folder',
    'create.folder.in': 'Create folder in {0}',
    'new.folder.placeholder': 'new-folder',
    'folder.required': 'Folder name is required.',
    'folder.relative': 'Use a relative folder name.',
    'copied': 'Copied: {0}',
    'rename.entry': 'Rename Remote Entry',
    'name.required': 'Name is required.',
    'name.no.slash': 'Name cannot contain "/".',
    'delete.entry': 'Delete "{0}"?',
    'btn.delete': 'Delete',
    'delete.saved': 'Delete saved connection "{0}"?',
    'upload.failed': 'SFTP upload failed: {0}',
    'downloading': '$(sync~spin) Downloading {0}...',
    'uploading': '$(cloud-upload) Uploading {0}...',
    'uploaded': '$(check) Uploaded {0}',

    // Webview strings
    'wv.savedConnections': 'Saved Connections',
    'wv.noSaved': 'No saved connections yet.',
    'wv.newConnection': 'New Connection',
    'wv.label': 'Label',
    'wv.protocol': 'Protocol',
    'wv.port': 'Port',
    'wv.host': 'Host',
    'wv.username': 'Username',
    'wv.auth': 'Auth',
    'wv.password': 'Password',
    'wv.privateKey': 'Private Key Path',
    'wv.remotePath': 'Remote Path',
    'wv.btnConnect': 'Connect',
    'wv.disconnected': 'Disconnected',
    'wv.connecting': 'Connecting...',
    'wv.connected': 'Connected',
    'wv.statusError': 'Error',
    'wv.hostRequired': 'Host is required',
    'wv.passwordRequired': 'Password required to connect to {0}',
    'wv.enterPassword': 'Please enter the password to connect to {0}.'
};

const pt: Dictionary = {
    'connect.first': 'Conecte-se a um servidor primeiro.',
    'new.file': 'Novo Arquivo Remoto',
    'create.file.in': 'Criar arquivo em {0}',
    'filename.txt': 'arquivo.txt',
    'file.required': 'O nome do arquivo é obrigatório.',
    'file.relative': 'Use um nome de arquivo relativo.',
    'new.folder': 'Nova Pasta Remota',
    'create.folder.in': 'Criar pasta em {0}',
    'new.folder.placeholder': 'nova-pasta',
    'folder.required': 'O nome da pasta é obrigatório.',
    'folder.relative': 'Use um nome de pasta relativo.',
    'copied': 'Copiado: {0}',
    'rename.entry': 'Renomear Entrada Remota',
    'name.required': 'O nome é obrigatório.',
    'name.no.slash': 'O nome não pode conter "/".',
    'delete.entry': 'Excluir "{0}"?',
    'btn.delete': 'Excluir',
    'delete.saved': 'Excluir a conexão salva "{0}"?',
    'upload.failed': 'Falha no upload SFTP: {0}',
    'downloading': '$(sync~spin) Baixando {0}...',
    'uploading': '$(cloud-upload) Enviando {0}...',
    'uploaded': '$(check) Enviado {0}',

    // Webview strings
    'wv.savedConnections': 'Conexões Salvas',
    'wv.noSaved': 'Nenhuma conexão salva ainda.',
    'wv.newConnection': 'Nova Conexão',
    'wv.label': 'Rótulo',
    'wv.protocol': 'Protocolo',
    'wv.port': 'Porta',
    'wv.host': 'Host',
    'wv.username': 'Usuário',
    'wv.auth': 'Autenticação',
    'wv.password': 'Senha',
    'wv.privateKey': 'Caminho da Chave Privada',
    'wv.remotePath': 'Caminho Remoto',
    'wv.btnConnect': 'Conectar',
    'wv.disconnected': 'Desconectado',
    'wv.connecting': 'Conectando...',
    'wv.connected': 'Conectado',
    'wv.statusError': 'Erro',
    'wv.hostRequired': 'O host é obrigatório',
    'wv.passwordRequired': 'Senha necessária para conectar em {0}',
    'wv.enterPassword': 'Informe a senha no campo Password para conectar em {0}.'
};

export function t(key: string, ...args: any[]): string {
    const lang = vscode.env.language.toLowerCase();
    const dict = lang.startsWith('pt') ? pt : en;
    let str = dict[key] || en[key] || key;
    
    args.forEach((arg, index) => {
        str = str.replace(`{${index}}`, String(arg));
    });
    
    return str;
}

export function getWebviewLocale() {
    const lang = vscode.env.language.toLowerCase();
    return lang.startsWith('pt') ? pt : en;
}

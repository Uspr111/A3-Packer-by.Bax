const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const functionCache = new Map();
let cacheInitialized = false;

async function indexFunctions() {
	try {
		functionCache.clear();
		
		const files = await vscode.workspace.findFiles('**/fn_*.sqf', '**/node_modules/**');
		
		for (const fileUri of files) {
			const fileName = path.basename(fileUri.fsPath, '.sqf');
			const functionShortName = fileName.replace(/^fn_/i, '').toLowerCase();
			functionCache.set(functionShortName, fileUri);
		}
		
		cacheInitialized = true;
	} catch (error) {
		cacheInitialized = false;
	}
}

function findFunctionDefinitionInDocument(document, functionName) {
	try {
		const text = document.getText();

		const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

		const regex = new RegExp(
			`\\b${escapedName}\\s*=\\s*(?:(?:compileFinal|compile)\\s*)?\\{`,
			'i'
		);
		
		const match = regex.exec(text);
		if (match) {
			return document.positionAt(match.index);
		}
		
		return null;
	} catch (error) {
		return null;
	}
}

async function findFunctionFile(functionName) {
	try {
		if (!cacheInitialized) {
			await indexFunctions();
		}

		const shortName = functionName.replace(/^.*?_fnc_/i, '').toLowerCase();
		
		const fileUri = functionCache.get(shortName);
		
		return fileUri || null;
	} catch (error) {
		return null;
	}
}

function parseParam(paramStr) {
	const simpleMatch = paramStr.match(/^["'](_\w+)["']$/);
	if (simpleMatch) {
		return simpleMatch[1];
	}

	const arrayMatch = paramStr.match(/^\[(.*)\]$/);
	if (!arrayMatch) {
		return paramStr;
	}
	
	const arrayContent = arrayMatch[1];
	const parts = [];

	let currentPart = '';
	let bracketDepth = 0;
	let inString = false;
	let stringChar = null;
	
	for (let i = 0; i < arrayContent.length; i++) {
		const char = arrayContent[i];
		
		if ((char === '"' || char === "'") && (i === 0 || arrayContent[i-1] !== '\\')) {
			if (!inString) {
				inString = true;
				stringChar = char;
			} else if (char === stringChar) {
				inString = false;
				stringChar = null;
			}
			currentPart += char;
			continue;
		}
		
		if (inString) {
			currentPart += char;
			continue;
		}

		if (char === '[') {
			bracketDepth++;
			currentPart += char;
			continue;
		}
		
		if (char === ']') {
			bracketDepth--;
			currentPart += char;
			continue;
		}

		if (char === ',' && bracketDepth === 0) {
			if (currentPart.trim()) {
				parts.push(currentPart.trim());
			}
			currentPart = '';
			continue;
		}
		
		currentPart += char;
	}

	if (currentPart.trim()) {
		parts.push(currentPart.trim());
	}
	
	if (parts.length === 0) {
		return paramStr;
	}

	const nameMatch = parts[0].match(/["'](_\w+)["']/);
	if (!nameMatch) {
		return parts[0];
	}
	
	let result = nameMatch[1];

	if (parts.length > 1 && parts[1] !== 'nil') {
		result += ` = ${parts[1]}`;
	}

	if (parts.length > 2) {
		result += ` : ${parts[2]}`;
	}
	
	return result;
}

function extractParams(text) {
	try {
		let cleanText = text
			.replace(/\/\*[\s\S]*?\*\//g, '')  // /* ... */
			.replace(/\/\/.*$/gm, '');         // // ...

		const lines = cleanText.split('\n').slice(0, 30).join('\n');

		const paramsMatch = lines.match(/params\s*\[([\s\S]*?)\]\s*;/i);
		if (!paramsMatch) {
			console.log('[BAX A3 Packer] Params не найдены');
			return [];
		}
		
		const paramsContent = paramsMatch[1];
		const params = [];

		const normalizedContent = paramsContent.replace(/\s+/g, ' ').trim();
		
		let i = 0;
		let currentParam = '';
		let bracketDepth = 0;
		let inString = false;
		let stringChar = null;
		
		while (i < normalizedContent.length) {
			const char = normalizedContent[i];

			if ((char === '"' || char === "'") && (i === 0 || normalizedContent[i-1] !== '\\')) {
				if (!inString) {
					inString = true;
					stringChar = char;
				} else if (char === stringChar) {
					inString = false;
					stringChar = null;
				}
				currentParam += char;
				i++;
				continue;
			}
			
			if (inString) {
				currentParam += char;
				i++;
				continue;
			}

			if (char === '[') {
				bracketDepth++;
				currentParam += char;
				i++;
				continue;
			}
			
			if (char === ']') {
				bracketDepth--;
				currentParam += char;
				i++;
				continue;
			}
			
			if (char === ',' && bracketDepth === 0) {
				if (currentParam.trim()) {
					params.push(parseParam(currentParam.trim()));
				}
				currentParam = '';
				i++;
				continue;
			}
			
			currentParam += char;
			i++;
		}

		if (currentParam.trim()) {
			params.push(parseParam(currentParam.trim()));
		}

		return params;
	} catch (error) {
		return [];
	}
}

async function getFunctionText(document, functionName) {
	try {
		const localPos = findFunctionDefinitionInDocument(document, functionName);
		if (localPos) {
			const text = document.getText();
			const startIdx = document.offsetAt(localPos);

			let braceCount = 0;
			let inFunction = false;
			let endIdx = startIdx;
			
			for (let i = startIdx; i < text.length; i++) {
				const char = text[i];
				if (char === '{') {
					braceCount++;
					inFunction = true;
				} else if (char === '}') {
					braceCount--;
					if (inFunction && braceCount === 0) {
						endIdx = i + 1;
						break;
					}
				}
			}
			
			return text.substring(startIdx, endIdx);
		}

		const fileUri = await findFunctionFile(functionName);
		if (fileUri) {
			const doc = await vscode.workspace.openTextDocument(fileUri);
			return doc.getText();
		}
		
		return null;
	} catch (error) {
		return null;
	}
}

function activate(context) {

	const packDisposable = vscode.commands.registerCommand('bax-a3-packer.packPBO', async function (uri) {
		if (!uri || !uri.fsPath) {
			return;
		}

		const folderPath = uri.fsPath;
		if (!fs.statSync(folderPath).isDirectory()) {
			vscode.window.showErrorMessage('Выберите папку для упаковки в PBO');
			return;
		}

		await packToPBO(folderPath, false);
	});

	const packDevDisposable = vscode.commands.registerCommand('bax-a3-packer.packPBODev', async function (uri) {
		if (!uri || !uri.fsPath) {
			return;
		}

		const folderPath = uri.fsPath;
		if (!fs.statSync(folderPath).isDirectory()) {
			vscode.window.showErrorMessage('Выберите папку для упаковки в PBO');
			return;
		}

		await packToPBO(folderPath, true);
	});

	const configureDisposable = vscode.commands.registerCommand('bax-a3-packer.configureFolderPath', async function (uri) {
		if (!uri || !uri.fsPath) {
			vscode.window.showErrorMessage('Не выбрана папка');
			return;
		}

		const folderPath = uri.fsPath;
		
		if (!fs.statSync(folderPath).isDirectory()) {
			vscode.window.showErrorMessage('Выберите папку');
			return;
		}

		await configureFolderPath(folderPath);
	});

	const binarizeDisposable = vscode.commands.registerCommand('bax-a3-packer.binarizeConfig', async function (uri) {
		if (!uri || !uri.fsPath) {
			vscode.window.showErrorMessage('Не выбран файл для бинаризации');
			return;
		}

		const filePath = uri.fsPath;
		if (fs.statSync(filePath).isDirectory()) {
			vscode.window.showErrorMessage('Выберите файл config.cpp для бинаризации');
			return;
		}

		await convertConfig(filePath, true);
	});

	const unbinarizeDisposable = vscode.commands.registerCommand('bax-a3-packer.unbinarizeConfig', async function (uri) {
		if (!uri || !uri.fsPath) {
			vscode.window.showErrorMessage('Не выбран файл для дебинаризации');
			return;
		}

		const filePath = uri.fsPath;
		if (fs.statSync(filePath).isDirectory()) {
			vscode.window.showErrorMessage('Выберите файл config.bin для дебинаризации');
			return;
		}

		await convertConfig(filePath, false);
	});

	const reindexDisposable = vscode.commands.registerCommand('bax-a3-packer.reindexFunctions', async function () {
		vscode.window.showInformationMessage('Запуск переиндексации...');
		
		try {
			await indexFunctions();
			vscode.window.showInformationMessage(`Индексация завершена. Функций найдено: ${functionCache.size}`);
		} catch (error) {
			vscode.window.showErrorMessage(`Ошибка индексации: ${error.message}`);
		}
	});

	indexFunctions().then(() => {
		console.log('indexing true');
	}).catch(error => {
		console.error('indexing error:', error);
	});
	
	const fileWatcher = vscode.workspace.createFileSystemWatcher('**/fn_*.sqf');
	fileWatcher.onDidCreate((uri) => {
		indexFunctions();
	});
	fileWatcher.onDidDelete((uri) => {
		indexFunctions();
	});

	const definitionProvider = vscode.languages.registerDefinitionProvider(
		{ language: 'sqf', scheme: 'file' },
		{
			async provideDefinition(document, position) {

				const wordRange = document.getWordRangeAtPosition(
					position,
					/["']?\w+_fnc_\w+["']?/
				);
				
				if (!wordRange) {
					console.log('[BAX A3 Packer] Слово не найдено под курсором');
					return null;
				}
				
				const functionName = document.getText(wordRange).replace(/["']/g, '');

				if (!/_fnc_/i.test(functionName)) {
					return null;
				}

				const localPos = findFunctionDefinitionInDocument(document, functionName);
				if (localPos) {
					return new vscode.Location(document.uri, localPos);
				}

				const fileUri = await findFunctionFile(functionName);
				if (fileUri) {
					return new vscode.Location(fileUri, new vscode.Position(0, 0));
				}

				return null;
			}
		}
	);

	const hoverProvider = vscode.languages.registerHoverProvider(
		{ language: 'sqf', scheme: 'file' },
		{
			async provideHover(document, position) {
				
				const wordRange = document.getWordRangeAtPosition(
					position,
					/["']?\w+_fnc_\w+["']?/
				);
				
				if (!wordRange) {
					return null;
				}
				
				const functionName = document.getText(wordRange).replace(/["']/g, '');
				
				if (!/_fnc_/i.test(functionName)) {
					return null;
				}

				const functionText = await getFunctionText(document, functionName);
				
				if (!functionText) {
					const markdown = new vscode.MarkdownString();
					markdown.appendCodeblock(functionName, 'sqf');
					markdown.appendMarkdown('\n\n_Определение функции не найдено в проекте_');
					return new vscode.Hover(markdown);
				}

				const params = extractParams(functionText);
				
				const markdown = new vscode.MarkdownString();
				markdown.appendCodeblock(functionName, 'sqf');
				
				if (params.length > 0) {
					markdown.appendMarkdown('\n\n**Параметры:**\n\n');
					params.forEach((param, idx) => {
						markdown.appendMarkdown(`${idx + 1}. \`${param}\`\n`);
					});
				} else {
					markdown.appendMarkdown('\n\n_Параметры не обнаружены_');
				}
				
				return new vscode.Hover(markdown);
			}
		}
	);

	const tokenTypes = ['function'];
	const tokenModifiers = [];
	const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);
	
	const semanticTokensProvider = {
		provideDocumentSemanticTokens(document) {
			const tokensBuilder = new vscode.SemanticTokensBuilder(legend);
			const text = document.getText();

			const regex = /\b\w+_fnc_\w+\b/gi;
			let match;
			let count = 0;
			
			while ((match = regex.exec(text)) !== null) {
				const startPos = document.positionAt(match.index);
				const endPos = document.positionAt(match.index + match[0].length);
				
				tokensBuilder.push(
					new vscode.Range(startPos, endPos),
					'function',
					[]
				);
				count++;
			}

			return tokensBuilder.build();
		}
	};
	
	const semanticTokensDisposable = vscode.languages.registerDocumentSemanticTokensProvider(
		{ language: 'sqf', scheme: 'file' },
		semanticTokensProvider,
		legend
	);
	
	context.subscriptions.push(
		packDisposable,
		packDevDisposable,
		configureDisposable,
		binarizeDisposable,
		unbinarizeDisposable,
		reindexDisposable,
		fileWatcher,
		definitionProvider,
		hoverProvider,
		semanticTokensDisposable
	);

}

async function configureFolderPath(folderPath) {
	const folderName = path.basename(folderPath);
	const config = vscode.workspace.getConfiguration('bax-a3-packer');
	const folderPaths = config.get('folderPaths') || {};
	
	const currentPath = folderPaths[folderName] || '';
	
	const newPath = await vscode.window.showInputBox({
		prompt: `Укажите путь для сохранения PBO файлов папки "${folderName}"`,
		value: currentPath,
		placeHolder: 'C:\\path\\to\\output\\directory'
	});

	if (newPath === undefined) return;

	if (newPath === '') {
		delete folderPaths[folderName];
	} else {
		if (!fs.existsSync(newPath)) {
			const create = await vscode.window.showWarningMessage(
				`Путь "${newPath}" не существует. Создать папку?`,
				'Создать', 'Отмена'
			);
			
			if (create === 'Создать') {
				try {
					fs.mkdirSync(newPath, { recursive: true });
				} catch (error) {
					vscode.window.showErrorMessage(`Не удалось создать папку: ${error.message}`);
					return;
				}
			} else {
				return;
			}
		}
		
		folderPaths[folderName] = newPath;
	}

	await config.update('folderPaths', folderPaths, vscode.ConfigurationTarget.Global);
	
	const message = newPath === '' 
		? `Индивидуальный путь для папки "${folderName}" удален`
		: `Путь для папки "${folderName}" установлен: ${newPath}`;
	
	vscode.window.showInformationMessage(message);
}

async function convertConfig(filePath, toBinary) {
	const config = vscode.workspace.getConfiguration('bax-a3-packer');
	let a3ToolsPath = config.get('a3ToolsPath');

	if (!a3ToolsPath || !fs.existsSync(a3ToolsPath)) {
		const action = await vscode.window.showErrorMessage(
			'Путь к A3Tools не настроен или неверен',
			'Указать путь', 'Отмена'
		);
		
		if (action === 'Указать путь') {
			const newPath = await vscode.window.showInputBox({
				prompt: 'Укажите путь к папке A3Tools',
				placeHolder: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Arma 3 Tools',
				value: a3ToolsPath || ''
			});
			
			if (!newPath) return;
			
			if (!fs.existsSync(newPath)) {
				vscode.window.showErrorMessage('Указанный путь не существует');
				return;
			}
			
			await config.update('a3ToolsPath', newPath, vscode.ConfigurationTarget.Global);
			a3ToolsPath = newPath;
			vscode.window.showInformationMessage('Путь к A3Tools сохранен');
		} else {
			return;
		}
	}

	const cfgConvertPath = path.join(a3ToolsPath, 'CfgConvert', 'CfgConvert.exe');
	if (!fs.existsSync(cfgConvertPath)) {
		vscode.window.showErrorMessage(`CfgConvert не найден по пути: ${cfgConvertPath}`);
		return;
	}

	const fileName = path.basename(filePath);
	const dir = path.dirname(filePath);
	const ext = path.extname(fileName);
	const nameWithoutExt = path.basename(fileName, ext);
	
	let outputFile, operation, mode;
	
	if (toBinary) {
		if (!fileName.toLowerCase().endsWith('.cpp')) {
			vscode.window.showErrorMessage('Для бинаризации выберите файл config.cpp');
			return;
		}
		outputFile = path.join(dir, nameWithoutExt + '.bin');
		operation = 'Бинаризация';
		mode = '-bin';
	} else {
		if (!fileName.toLowerCase().endsWith('.bin')) {
			vscode.window.showErrorMessage('Для дебинаризации выберите файл config.bin');
			return;
		}
		outputFile = path.join(dir, nameWithoutExt + '.cpp');
		operation = 'Дебинаризация';
		mode = '-txt';
	}

	if (fs.existsSync(outputFile)) {
		const overwrite = await vscode.window.showWarningMessage(
			`Файл ${path.basename(outputFile)} уже существует. Перезаписать?`,
			'Перезаписать', 'Отмена'
		);
		
		if (overwrite !== 'Перезаписать') {
			return;
		}
	}

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: `${operation} ${fileName}...`,
		cancellable: false
	}, async (progress) => {
		return new Promise((resolve, reject) => {
			const command = `"${cfgConvertPath}" ${mode} -dst "${outputFile}" "${filePath}"`;
			
			exec(command, (error, stdout, stderr) => {
				if (error) {
					vscode.window.showErrorMessage(`Ошибка ${operation.toLowerCase()}: ${error.message}`);
					reject(error);
					return;
				}
				
				if (stderr && stderr.trim()) {
					vscode.window.showWarningMessage(`Предупреждения: ${stderr}`);
				}
				
				if (fs.existsSync(outputFile)) {
					vscode.window.showInformationMessage(`${operation} завершена: ${path.basename(outputFile)}`);
					
					if (!toBinary) {
						vscode.workspace.openTextDocument(outputFile).then(doc => {
							vscode.window.showTextDocument(doc);
						}, err => {
							console.log('Не удалось открыть файл:', err.message);
						});
					}
				} else {
					vscode.window.showErrorMessage(`${operation} не удалась - выходной файл не создан`);
				}
				
				resolve();
			});
		});
	});
}

function getOutputPathForFolder(folderPath) {
	const config = vscode.workspace.getConfiguration('bax-a3-packer');
	const folderName = path.basename(folderPath);
	const folderPaths = config.get('folderPaths') || {};
	const defaultOutputPath = config.get('outputPath');

	if (folderPaths[folderName] && fs.existsSync(folderPaths[folderName])) {
		return folderPaths[folderName];
	}

	if (defaultOutputPath && fs.existsSync(defaultOutputPath)) {
		return defaultOutputPath;
	}

	return path.dirname(folderPath);
}

async function packToPBO(folderPath, devMode = false) {
	const config = vscode.workspace.getConfiguration('bax-a3-packer');
	let a3ToolsPath = config.get('a3ToolsPath');

	if (!a3ToolsPath || !fs.existsSync(a3ToolsPath)) {
		const action = await vscode.window.showErrorMessage(
			'Путь к A3Tools не настроен или неверен',
			'Указать путь', 'Отмена'
		);
		
		if (action === 'Указать путь') {
			const newPath = await vscode.window.showInputBox({
				prompt: 'Укажите путь к папке A3Tools',
				placeHolder: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Arma 3 Tools',
				value: a3ToolsPath || ''
			});
			
			if (!newPath) return;
			
			if (!fs.existsSync(newPath)) {
				vscode.window.showErrorMessage('Указанный путь не существует');
				return;
			}
			
			await config.update('a3ToolsPath', newPath, vscode.ConfigurationTarget.Global);
			a3ToolsPath = newPath;
			vscode.window.showInformationMessage('Путь к A3Tools сохранен');
		} else {
			return;
		}
	}

	const addonBuilderPath = path.join(a3ToolsPath, 'AddonBuilder', 'AddonBuilder.exe');
	if (!fs.existsSync(addonBuilderPath)) {
		vscode.window.showErrorMessage(`AddonBuilder не найден по пути: ${addonBuilderPath}`);
		return;
	}

	const targetDirectory = getOutputPathForFolder(folderPath);
	const folderName = path.basename(folderPath);
	const pboFileName = `${folderName}.pbo`;
	const outputFilePath = path.join(targetDirectory, pboFileName);

	const modeText = devMode ? ' (режим разработки)' : '';

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: `Упаковка ${folderName} в PBO${modeText}...`,
		cancellable: false
	}, async (progress) => {
		return new Promise((resolve, reject) => {
			let command = `"${addonBuilderPath}" "${folderPath}" "${targetDirectory}"`;
			
			const tempPath = config.get('tempPath');
			const projectPath = config.get('projectPath');
			const signKey = config.get('signKey');
			const includeExtensions = config.get('includeExtensions');

			let tempIncludeFile = null;

			if (devMode) {
				command += ' -packonly';
			} else {
				command += ' -clear';
			}

			if (tempPath && fs.existsSync(tempPath)) {
				command += ` -temp="${tempPath}"`;
			}

			if (projectPath && fs.existsSync(projectPath)) {
				command += ` -project="${projectPath}"`;
			}

			if (signKey && fs.existsSync(signKey)) {
				command += ` -sign="${signKey}"`;
			}

			if (includeExtensions && includeExtensions.trim()) {
				tempIncludeFile = path.join(require('os').tmpdir(), `a3_include_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.txt`);
				try {
					const cleanedExtensions = includeExtensions.split(/[;,]/)
						.map(ext => ext.trim())
						.filter(ext => ext.length > 0)
						.join(';');
					
					fs.writeFileSync(tempIncludeFile, cleanedExtensions);
					command += ` -include="${tempIncludeFile}"`;
				} catch (error) {
					tempIncludeFile = null;
				}
			}
			
			exec(command, { 
				cwd: path.dirname(addonBuilderPath),
				maxBuffer: 1024 * 1024 * 10
			}, (error, stdout, stderr) => {
				if (tempIncludeFile) {
					try {
						if (fs.existsSync(tempIncludeFile)) {
							fs.unlinkSync(tempIncludeFile);
						}
					} catch (cleanupError) {}
				}

				if (error) {
					const errorMessage = stderr || stdout || error.message;
					if (errorMessage.includes('Build failed')) {
						vscode.window.showErrorMessage(`Сборка не удалась. Проверьте содержимое папки и права доступа.`);
					} else {
						vscode.window.showErrorMessage(`Ошибка упаковки: ${error.message}`);
					}
					reject(error);
					return;
				}

				if (fs.existsSync(outputFilePath)) {
					const fileStats = fs.statSync(outputFilePath);
					const fileSizeKB = Math.round(fileStats.size / 1024);
					
					vscode.window.showInformationMessage(
						`PBO файл успешно создан: ${pboFileName} (${fileSizeKB} KB)${modeText}\nПуть: ${targetDirectory}`,
						'Открыть папку'
					).then(selection => {
						if (selection === 'Открыть папку') {
							vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputFilePath));
						}
					});
				} else {
					try {
						const pboFiles = fs.readdirSync(targetDirectory).filter(file => file.endsWith('.pbo'));
						if (pboFiles.length > 0) {
							vscode.window.showInformationMessage(
								`Упаковка завершена. Найдены PBO файлы: ${pboFiles.join(', ')}`,
								'Открыть папку'
							).then(selection => {
								if (selection === 'Открыть папку') {
									vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetDirectory));
								}
							});
						} else {
							vscode.window.showWarningMessage('PBO файл не найден.');
						}
					} catch (readError) {
						vscode.window.showWarningMessage(`Не удалось проверить выходную папку: ${readError.message}`);
					}
				}

				resolve();
			});
		});
	});
}

function deactivate() {
	console.log('deactivate');
}

module.exports = {
	activate,
	deactivate
};
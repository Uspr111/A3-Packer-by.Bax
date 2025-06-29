const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function activate(context) {
	const packDisposable = vscode.commands.registerCommand('bax-a3-packer.packPBO', async function (uri) {
		if (!uri || !uri.fsPath) {
			vscode.window.showErrorMessage('Не выбрана папка для упаковки');
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
			vscode.window.showErrorMessage('Не выбрана папка для упаковки');
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

	context.subscriptions.push(packDisposable, packDevDisposable, configureDisposable, binarizeDisposable, unbinarizeDisposable);
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

function deactivate() {}

module.exports = {
	activate,
	deactivate
}
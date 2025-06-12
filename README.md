# A3 Packer by.Bax

Расширение для VS Code, предназначенное для разработки модов Arma 3. Позволяет упаковывать папки в PBO файлы прямо из проводника с индивидуальными настройками путей для каждой папки.

## Возможности

- **Упаковка в PBO**: Щелкните правой кнопкой мыши по папке и выберите "Запаковать в PBO"
- **Режим разработки**: "Запаковать в PBO (режим разработки)" - упаковка без бинаризации (пока сломано из-за AddonBuilder, читайте ниже)
- **Индивидуальные пути**: Настройте отдельные пути сохранения для каждой папки

## Режимы упаковки

### Обычный режим
- **"Запаковать в PBO"** - Полная упаковка с бинаризацией конфигов и очисткой временных файлов

### Режим разработки  
- **"Запаковать в PBO (режим разработки)"** - Быстрая упаковка без бинаризации файлов (config.bin содержит код но поверх этого лежит config.cpp для удобного чтения) ps.Так работает AddonBuilder

## Требования

- Необходимо установить Arma 3 Tools

### Настройки расширения

#### Основные настройки
- `bax-a3-packer.a3ToolsPath`: Путь к папке A3Tools
  - Пример: `C:\Program Files (x86)\Steam\steamapps\common\Arma 3 Tools`
- `bax-a3-packer.outputPath`: Общий путь для сохранения PBO файлов (необязательно)
- `bax-a3-packer.folderPaths`: Индивидуальные пути для конкретных папок

#### Дополнительные настройки
- `bax-a3-packer.tempPath`: Путь для временных файлов бинаризации
- `bax-a3-packer.projectPath`: Корневой путь проекта
- `bax-a3-packer.signKey`: Путь к .biprivatekey файлу для подписи

### Подпись PBO 

Для подписи PBO приватным ключом:
1. Создайте или получите .biprivatekey файл
2. Укажите путь к файлу в настройке `signKey`
3. PBO файлы будут автоматически подписываться

```json
{
  "bax-a3-packer.signKey": "C:\\keys\\mykey.biprivatekey"
}
```

## Использование

1. Откройте папку с вашим проектом Arma 3 в VS Code
2. **Для обычной упаковки**: Щелкните правой кнопкой по папке → "Запаковать в PBO"
3. **Для режима разработки**: Щелкните правой кнопкой по папке → "Запаковать в PBO (режим разработки)"
4. **Для настройки пути**: Щелкните правой кнопкой по папке → "Настроить путь PBO для папки"

## Пример настройки проекта

Для проекта со структурой:
```
MyArma3Project/
├── core_addon/          → сохранить в C:\Arma3\@MyMod\addons\
├── vehicle_addon/       → сохранить в C:\Arma3\@MyMod\addons\
└── test_mission/        → сохранить в C:\Arma3\MPMissions\
```

```json
{
  "bax-a3-packer.a3ToolsPath": "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Arma 3 Tools",
  "bax-a3-packer.tempPath": "C:\\Temp\\A3Build",
  "bax-a3-packer.projectPath": "C:\\Dev\\MyArma3Project",
  "bax-a3-packer.signKey": "C:\\keys\\mymod.biprivatekey",
  "bax-a3-packer.folderPaths": {
    "core_addon": "C:\\Arma3\\@MyMod\\addons",
    "vehicle_addon": "C:\\Arma3\\@MyMod\\addons",
    "test_mission": "C:\\Arma3\\MPMissions"
  }
}
```

## Параметры AddonBuilder

Расширение использует следующие параметры AddonBuilder:

- **Обычный режим**: `AddonBuilder.exe "source" "output" -clear`
  - `-clear`: Очищает временные файлы и выполняет полную бинаризацию
  
- **Режим разработки**: `AddonBuilder.exe "source" "output" -packonly`
  - `-packonly`: Только упаковка без бинаризации файлов


## Решение проблем

### PBO содержит только config файлы

Если в обычном режиме упаковываются только конфиги, проверьте настройки:

1. **Настройте расширения файлов**:
```json
{
  "bax-a3-packer.includeExtensions": "*.sqf;*.sqs;*.h;*.hpp;*.inc;*.cpp;*.cfg;*.ext;*.txt;*.paa;*.p3d;*.ogg;*.wav;*.rvmat;*.sqm"
}
```

2. **Укажите корневой путь проекта**:
```json
{
  "bax-a3-packer.projectPath": "C:\\Dev\\YourProject"
}
```

3. **Настройте временную папку** (опционально):
```json
{
  "bax-a3-packer.tempPath": "C:\\Temp\\A3Build"
}
```

### Рекомендуемые настройки

```json
{
  "bax-a3-packer.a3ToolsPath": "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Arma 3 Tools",
  "bax-a3-packer.projectPath": "C:\\Dev\\YourProject",
  "bax-a3-packer.includeExtensions": "*.sqf;*.sqs;*.h;*.hpp;*.inc;*.cpp;*.cfg;*.ext;*.txt;*.paa;*.p3d;*.ogg;*.wav;*.rvmat;*.sqm;*.fsm;*.bikb;*.lip;*.csv;*.html;*.fxy;*.wrp;*.bisurf",
  "bax-a3-packer.folderPaths": {
    "your_addon": "C:\\Arma3\\@YourMod\\addons"
  }
}
```

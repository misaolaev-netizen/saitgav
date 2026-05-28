# Куда смотреть в коде

| Модуль | Назначение |
|--------|------------|
| `config.py` | Поля Word, колонки Excel |
| `loaders.py`, `reload.py` | Загрузка из data/ |
| `store.py` | Записи по ФИО, layout шаблонов |
| `docgen.py` | Генерация docx, таблицы, batch |
| `template_scan.py` | single / combined, якоря таблицы |
| `docx_table_brace.py` | Строки таблицы по `{поле}` |
| `docx_placeholders.py`, `merge_expand.py` | Подстановка `{поле}` |
| `docx_edit.py` | Правки из HTML предпросмотра |
| `docpreview.py` | HTML предпросмотр |
| `diploma_tables.py`, `table_data.py` | Excel-таблицы для актов |
| `morphology.py` | Склонение ФИО |

Фронтенд: `static/js/f2a-*.js`, `constructor.js`, `preview-word.js`

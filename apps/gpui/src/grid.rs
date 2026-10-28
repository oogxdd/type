//! Virtualized, sortable table view for CSV/TSV and JSON record arrays.
use super::*;
use gpui_kit::component::table::{Column, ColumnSort, TableDelegate, TableState};
use type_gpui::convert::Grid;

pub(crate) struct GridDelegate {
    columns: Vec<Column>,
    rows: Vec<Vec<SharedString>>,
    /// Display order over `rows`; sorting never touches the file.
    order: Vec<usize>,
}

impl GridDelegate {
    pub fn new(grid: Grid) -> Self {
        let rows: Vec<Vec<SharedString>> = grid
            .rows
            .into_iter()
            .map(|row| row.into_iter().map(SharedString::from).collect())
            .collect();
        let width = grid
            .columns
            .len()
            .max(rows.iter().map(Vec::len).max().unwrap_or(0));
        let columns = (0..width)
            .map(|ix| {
                let name = grid.columns.get(ix).cloned().unwrap_or_default();
                // Size from the header and the first rows; drag to resize.
                let chars = rows
                    .iter()
                    .take(200)
                    .filter_map(|row| row.get(ix))
                    .map(|cell| cell.chars().count())
                    .chain([name.chars().count() + 2])
                    .max()
                    .unwrap_or(0);
                Column::new(format!("col-{ix}"), name)
                    .width(px((chars as f32 * 8. + 24.).clamp(64., 360.)))
                    .sortable()
            })
            .collect();
        let order = (0..rows.len()).collect();
        Self {
            columns,
            rows,
            order,
        }
    }

    fn cell(&self, row_ix: usize, col_ix: usize) -> SharedString {
        self.order
            .get(row_ix)
            .and_then(|&row| self.rows[row].get(col_ix))
            .cloned()
            .unwrap_or_default()
    }
}

/// Numbers compare numerically, everything else case-insensitively.
fn compare(a: &str, b: &str) -> std::cmp::Ordering {
    match (a.trim().parse::<f64>(), b.trim().parse::<f64>()) {
        (Ok(a), Ok(b)) => a.total_cmp(&b),
        (Ok(_), Err(_)) => std::cmp::Ordering::Less,
        (Err(_), Ok(_)) => std::cmp::Ordering::Greater,
        _ => a.to_lowercase().cmp(&b.to_lowercase()),
    }
}

impl TableDelegate for GridDelegate {
    fn columns_count(&self, _: &App) -> usize {
        self.columns.len()
    }

    fn rows_count(&self, _: &App) -> usize {
        self.rows.len()
    }

    fn column(&self, col_ix: usize, _: &App) -> Column {
        self.columns[col_ix].clone()
    }

    fn perform_sort(
        &mut self,
        col_ix: usize,
        sort: ColumnSort,
        _: &mut Window,
        _: &mut Context<TableState<Self>>,
    ) {
        self.order = (0..self.rows.len()).collect();
        let key = |row: &usize| {
            self.rows[*row]
                .get(col_ix)
                .map(|c| c.as_ref())
                .unwrap_or("")
        };
        match sort {
            ColumnSort::Ascending => self.order.sort_by(|a, b| compare(key(a), key(b))),
            ColumnSort::Descending => self.order.sort_by(|a, b| compare(key(b), key(a))),
            ColumnSort::Default => {}
        }
    }

    fn render_td(
        &mut self,
        row_ix: usize,
        col_ix: usize,
        _: &mut Window,
        _: &mut Context<TableState<Self>>,
    ) -> impl IntoElement {
        let text = self.cell(row_ix, col_ix);
        div().truncate().child(if text.contains('\n') {
            SharedString::from(text.replace('\n', " ⏎ "))
        } else {
            text
        })
    }

    fn cell_text(&self, row_ix: usize, col_ix: usize, _: &App) -> String {
        self.cell(row_ix, col_ix).to_string()
    }
}

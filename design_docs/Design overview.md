This is a minimal app to allow easy logging of data to a Google Sheets spreadsheet.

# Functionality

The app will be hardcoded to work specifically for one user (me) and one spreadsheet in their Google account.

The home page of the app will be a list of the existing sheets in that spreadsheet.

Tapping one of the sheets takes the user to a screen where they can enter some data to create a new row in that sheet.

The form for this screen will be created dynamically based on the contents of the sheet, assuming the below standard format.

### Standard sheet format

Sheets must be formatted as a table with its top left corner in cell A1. The top row is a header row and the second row is a typing row, where values specify the type of values allowed for that column. The third row has boolean values that specify whether the column is required (i.e. whether empty cells are allowed). Rows from 4 onwards contain actual data.

### Logic for dynamic logging form

When the user opens the logging screen for a particular sheet, the app will get the first 3 rows of the sheet, which contain the column metadata. One input is shown on the screen for each column. The sheet metadata is used to determine the input names to show on the screen (top row), the type of input (second row), and whether to allow submission with a null value (third row).

When the user submits the form, this appends a new row to the bottom of the table in the sheet. The form resets so that the user can add more rows if required. 

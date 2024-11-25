// Function to check links and add no-link class
function checkLinks() {
    // Get all cells with links
    const cellsWithLinks = document.querySelectorAll('.icon-cell');
    
    cellsWithLinks.forEach(cell => {
		// Skip if the cell contains a nextdate-icon
        if (cell.querySelector('.nextdate-icon')) {
            return;
        }
		
        // Check if the cell has an anchor tag that's not commented out
        const link = cell.querySelector('a');
        const cellHTML = cell.innerHTML;
        
        // If there's no link, or if the link is commented out (contains <!--<a)
        if (!link || cellHTML.includes('<!--<a')) {
            cell.classList.add('no-link');
        }
    });
}

// Get the current date
const currentDate = new Date();

// Calculate the date 6 days from now
const fiveDaysLater = new Date();
fiveDaysLater.setDate(fiveDaysLater.getDate() + 5);

// Get all elements with the class "icon-cell"
const iconCells = document.querySelectorAll('.icon-cell');

// Loop through each icon cell
iconCells.forEach(iconCell => {
// Get the date value from the cell
const dateText = iconCell.textContent.trim();
const eventDate = new Date(dateText);

// Get the icon element inside the cell
const iconElement = iconCell.querySelector('.nextdate-icon');

// Compare the dates
if (eventDate <= currentDate) {
  // Add the "fa-flip" class to the icon
  iconElement.classList.add('fa-flip');
  // Add the "red-icon" class to the icon for red color
  iconElement.classList.add('red-icon');
} else if (eventDate <= fiveDaysLater) {
  // Add the "fa-beat" class to the icon
  iconElement.classList.add('fa-beat');
  // Add the "red-icon" class to the icon for red color
  iconElement.classList.add('red-icon');
}
});

// Run the link check when the document loads
document.addEventListener('DOMContentLoaded', checkLinks);
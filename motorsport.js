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

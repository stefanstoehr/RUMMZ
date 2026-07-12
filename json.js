// HELPER: Export project data as JSON
function exportProjectAsJSON() {
    const exportData = {
        title: projectTitle,
        boreholes: cardsData
    };
    const jsonText = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectTitle || 'rummz_project'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// DOWNLOAD DATASET
document.getElementById('json-download').addEventListener('click', exportProjectAsJSON);

// UPLOAD DATASET
document.getElementById('json-upload').addEventListener('click', (event) => {
    event.preventDefault();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const importedData = JSON.parse(event.target.result);
                
                // Handle new format: { title, boreholes }
                if (importedData.boreholes && Array.isArray(importedData.boreholes)) {
                    projectTitle = importedData.title || '';
                    cardsData = importedData.boreholes;
                }
                // Handle old format: direct array
                else if (Array.isArray(importedData)) {
                    projectTitle = '';
                    cardsData = importedData;
                } else {
                    alert('Invalid JSON file. The file should contain either an array of cards or an object with { title, boreholes }.');
                    return;
                }
                
                // Clear existing map instances before re-rendering
                Object.values(mapInstances).forEach(map => map.remove());
                mapInstances = {};
                
                initialRender();
                triggerVisualisationUpdate();
            } catch (error) {
                alert('Error parsing JSON file: ' + error.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
});

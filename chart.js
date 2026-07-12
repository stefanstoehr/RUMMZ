/**
 * Chart Management Module
 * 
 * Updates four chart types based on borehole data:
 * 1. Bar chart: Borehole depth comparison
 * 2. Doughnut chart: Material thickness ranking
 * 3. Horizontal bar chart: Material volume comparison
 * 4. Legend: Material color reference
 * 
 * Uses Chart.js library for rendering
 */

// Helper: Clear and recreate canvas in container
function updateChart(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const oldCanvas = container.querySelector('canvas');
    if (oldCanvas) oldCanvas.remove();
    
    const oldAwaitMsg = container.querySelector('#card-title-total');
    if (oldAwaitMsg) oldAwaitMsg.remove();
    
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    return new Chart(canvas.getContext('2d'), config);
}

export function updateCharts(cardsData, volumes) {
    // === BAR CHART: Borehole Depth Comparison ===
    const maxLayerCount = cardsData.reduce((max, item) => Math.max(max, item.layers?.length || 0), 0);
    const datasets = Array.from({ length: maxLayerCount }, (_, layerIndex) => {
        const data = cardsData.map(item => {
            const layer = item.layers[layerIndex];
            return layer ? -layer.height : 0;
        });
        const layerNames = cardsData.map(item => item.layers[layerIndex]?.name || '');
        const backgroundColor = cardsData.map(item => item.layers[layerIndex]?.color || 'rgba(0,0,0,0)');
        return {
            label: `Schicht ${layerIndex + 1}`,
            data,
            backgroundColor,
            borderWidth: 1,
            borderColor: backgroundColor,
            layerNames,
        };
    });
    
    const barConfig = {
        type: 'bar',
        data: {
            labels: cardsData.map((_, index) => `${index + 1}`),
            datasets: datasets
        },
        options: {
            responsive: true,
            aspectRatio: 1,
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    position: 'top',
                },
                y: {
                    stacked: true,
                    min: (() => {
                        const totalDepths = cardsData.map((_, index) => {
                            return datasets.reduce((sum, dataset) => {
                                const value = dataset.data[index] || 0;
                                return sum + value;
                            }, 0);
                        });
                        return Math.min(...totalDepths);
                    })(),
                    max: 0,
                    position: 'left',
                    ticks: {
                        callback: function(value) {
                            return Math.abs(value);
                        }
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            return `Bohrung ${context[0].label}`;
                        },
                        label: function(context) {
                            const layerName = context.dataset.layerNames?.[context.dataIndex] || context.dataset.label;
                            const value = Math.abs((context.parsed?.y ?? context.parsed) || 0);
                            return `${layerName}: ${value} cm`;
                        }
                    }
                }
            }
        }
    };
    
    updateChart('bohrtiefen', barConfig);

    // === DOUGHNUT CHART: Material Thickness Ranking ===
    const materialMap = {};
    const colorMap = {};
    cardsData.forEach(item => {
        item.layers.forEach(layer => {
            if (!materialMap[layer.name]) {
                materialMap[layer.name] = 0;
                colorMap[layer.name] = layer.color || '#000000';
            }
            materialMap[layer.name] += layer.height;
        });
    });
    const sorted = Object.entries(materialMap).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(([name]) => name);
    const values = sorted.map(([, value]) => value);
    const colors = labels.map(l => colorMap[l]);
    
    const pieConfig = {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors
            }]
        },
        options: {
            responsive: true,
            cutout: '60%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.label}: ${context.raw} cm`;
                        }
                    }
                }
            }
        }
    };
    
    updateChart('materialranking', pieConfig);

    // === HORIZONTAL BAR CHART: Volume Comparison ===
    if (volumes) {
        const sortedVolume = Object.entries(volumes).sort((a, b) => a[1].volume - b[1].volume);
        const volumeLabels = sortedVolume.map(([name]) => name);
        const volumeValues = sortedVolume.map(([, data]) => data.volume);
        const volumeColors = sortedVolume.map(([, data]) => data.color);

        const volumeConfig = {
            type: 'bar',
            data: {
                labels: volumeLabels,
                datasets: [{
                    data: volumeValues,
                    backgroundColor: volumeColors,
                    borderColor: volumeColors,
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                aspectRatio: 1,
                scales: {
                    x: { beginAtZero: true },
                    y: {
                        grid: { display: false },
                        ticks: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `${context.label}: ${context.raw.toFixed(2)} m³`;
                            }
                        }
                    }
                }
            }
        };
        
        updateChart('volumenranking', volumeConfig);
    }
    
    // === LEGEND: Material Color Reference ===
    const legendeDiv = document.getElementById('legende');
    if (legendeDiv) {
        const oldLegend = legendeDiv.querySelector('.legend-container');
        if (oldLegend) oldLegend.remove();
        const oldAwaitMsg = legendeDiv.querySelector('#card-title-total');
        if (oldAwaitMsg) oldAwaitMsg.remove();

        const legendContainer = document.createElement('div');
        legendContainer.className = 'legend-container';
        legendContainer.style.display = 'flex';
        legendContainer.style.flexWrap = 'wrap';
        legendContainer.style.gap = '1rem';

        Object.entries(colorMap).forEach(([name, color]) => {
            const legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            legendItem.style.display = 'flex';
            legendItem.style.alignItems = 'center';
            legendItem.style.gap = '0.5rem';

            const colorBox = document.createElement('div');
            colorBox.style.width = '15px';
            colorBox.style.height = '15px';
            colorBox.style.backgroundColor = color;
            colorBox.style.border = '1px solid #ccc';
            colorBox.style.flexShrink = '0';

            const label = document.createElement('span');
            label.textContent = name;
            label.style.wordBreak = 'break-word';
            label.style.fontSize = '0.85rem';

            legendItem.appendChild(colorBox);
            legendItem.appendChild(label);
            legendContainer.appendChild(legendItem);
        });

        legendeDiv.appendChild(legendContainer);
    }
}
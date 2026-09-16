$(document).ready(function () {
  // Crear el gráfico y el papel de JointJS
  const graph = new joint.dia.Graph();
  const paper = new joint.dia.Paper({
    el: $("#diagram"),
    model: graph,
    width: 1000,
    height: 800,
    gridSize: 10,
    interactive: true,
  });

  let selectedSource = null; // Clase de origen
  let selectedTarget = null; // Clase de destino
  let currentRelationType = null; // Tipo de relación que se quiere agregar
  let isMoving = false; // Bandera para detectar si se está moviendo una clase

  // Función para resetear el color de los bordes de las clases
  function resetClassBorders() {
    if (selectedSource) {
      selectedSource.attr(".uml-class-name-rect/stroke", "#000000"); // Volver a color negro
    }
    if (selectedTarget) {
      selectedTarget.attr(".uml-class-name-rect/stroke", "#000000"); // Volver a color negro
    }
  }
  let clickedElement = null; // Guardar el elemento en el que se hizo clic

  // Mostrar el menú contextual al hacer clic derecho en una clase
  paper.on("element:contextmenu", function (elementView, evt, x, y) {
    evt.preventDefault(); // Prevenir el menú contextual predeterminado del navegador
    clickedElement = elementView.model; // Guardar el elemento seleccionado

    // Mostrar el menú contextual en la posición del clic
    $("#contextMenu")
      .css({
        top: evt.pageY + "px",
        left: evt.pageX + "px",
      })
      .show();
  });

  // Ocultar el menú contextual cuando se haga clic en cualquier lugar fuera de él
  $(document).on("click", function () {
    $("#contextMenu").hide();
  });

  // Función para editar el nombre de la clase
  $("#editName").on("click", function () {
    const newName = prompt(
      "Editar Nombre de la Clase",
      clickedElement.get("name")
    );
    if (newName !== null) {
      clickedElement.attr(".uml-class-name-text/text", newName);
      clickedElement.set("name", newName);
      $("#contextMenu").hide();
    }
  });

  // Función para editar los atributos de la clase
  $("#editAttributes").on("click", function () {
    const currentAttrs = clickedElement.get("attributes").join(", ");
    const newAttrs = prompt(
      "Editar Atributos (separados por coma)",
      currentAttrs
    );
    if (newAttrs !== null) {
      const newAttrsArray = newAttrs.split(",").map((attr) => attr.trim());
      clickedElement.attr(
        ".uml-class-attrs-text/text",
        newAttrsArray.join("\n")
      );
      clickedElement.set("attributes", newAttrsArray);
      $("#contextMenu").hide();
    }
  });

  // Función para editar los métodos de la clase
  $("#editMethods").on("click", function () {
    const currentMethods = clickedElement.get("methods").join(", ");
    const newMethods = prompt(
      "Editar Métodos (separados por coma)",
      currentMethods
    );
    if (newMethods !== null) {
      const newMethodsArray = newMethods
        .split(",")
        .map((method) => method.trim());
      clickedElement.attr(
        ".uml-class-methods-text/text",
        newMethodsArray.join("\n")
      );
      clickedElement.set("methods", newMethodsArray);
      $("#contextMenu").hide();
    }
  });
  
  $("#deleteClass").on("click", function () {
    if (confirm("¿Estás seguro de que deseas eliminar esta clase?")) {
      clickedElement.remove(); // Eliminar la clase del gráfico
      $("#contextMenu").hide(); // Ocultar el menú
    }
  });

  // Función para generar un ID único
  function generateId(prefix) {
    return prefix + "_" + Math.random().toString(36).substr(2, 9);
  }

  // Función para agregar una nueva clase UML
  function addUMLClass(name, attributes, methods, position) {
    const id = generateId(name); // Generar un ID único
    const umlClass = new joint.shapes.uml.Class({
      position: position,
      size: { width: 250, height: 150 }, // Ajustar el tamaño
      name: name,
      attributes: attributes,
      methods: methods,
      id: id,
      attrs: {
        ".uml-class-name-rect": {
          fill: "#FFFFE0", // Fondo color crema claro
          stroke: "#000000", // Borde negro
          "stroke-width": 1, // Grosor del borde
          rx: 0, // Esquinas cuadradas
          ry: 0, // Esquinas cuadradas
        },
        ".uml-class-attrs-rect": {
          fill: "#FFFFE0", // Fondo crema para atributos
          stroke: "#000000", // Borde negro
          "stroke-width": 1, // Grosor del borde
          rx: 0, // Esquinas cuadradas
          ry: 0, // Esquinas cuadradas
        },
        ".uml-class-methods-rect": {
          fill: "#FFFFE0", // Fondo crema para métodos
          stroke: "#000000", // Borde negro
          "stroke-width": 1, // Grosor del borde
          rx: 0, // Esquinas cuadradas
          ry: 0, // Esquinas cuadradas
        },
        ".uml-class-name-text": {
          "font-family": "Arial", // Cambiar fuente
          "font-size": 14, // Tamaño de fuente más grande para el nombre de la clase
          "font-weight": "bold", // Negrita para el nombre
          fill: "#000000", // Color de texto negro
          "text-anchor": "middle", // Centramos el nombre
          "ref-x": 0.5, // Posiciona en el centro horizontal
          "ref-y": 0.5, // Posiciona en el centro vertical
          "y-alignment": "middle", // Alineación vertical
        },
        ".uml-class-attrs-text": {
          "font-family": "Arial", // Fuente para los atributos
          "font-size": 12, // Tamaño de fuente
          fill: "#000000", // Color de texto
          "text-anchor": "start", // Alineación del texto a la izquierda
          "ref-x": 10, // Margen izquierdo
          "ref-y": 5, // Margen superior
        },
        ".uml-class-methods-text": {
          "font-family": "Arial", // Fuente para los métodos
          "font-size": 12, // Tamaño de fuente
          fill: "#000000", // Color de texto
          "text-anchor": "start", // Alineación del texto a la izquierda
          "ref-x": 10, // Margen izquierdo
          "ref-y": 5, // Margen superior
        },
      },
    });
    graph.addCell(umlClass);
  }

  // Manejar clics para agregar clases
  $("#addUserClass").on("click", function () {
    addUMLClass("Clase", [], [], { x: 100, y: 50 });
  });

  // Función para agregar una relación
  function addRelationship(type) {
    currentRelationType = type; // Establecer el tipo de relación actual
    $("#selectionInfo").text(
      "Selecciona el origen y destino para la relación."
    );
    selectedSource = null; // Reiniciar las selecciones de clases
    selectedTarget = null;
    resetClassBorders(); // Reiniciar los bordes de las clases
  }

  // Seleccionar el origen y el destino para la relación después de hacer clic en el botón de relación
  paper.on("element:pointerdown", (cellView) => {
    if (isMoving) return; // No hacer nada si se está moviendo la clase

    if (currentRelationType) {
      // Solo permitir selección si se ha seleccionado un tipo de relación
      if (!selectedSource) {
        selectedSource = cellView.model;
        selectedSource.attr(".uml-class-name-rect/stroke", "#FF0000"); // Cambiar borde a rojo para indicar origen
      } else if (!selectedTarget) {
        selectedTarget = cellView.model;
        selectedTarget.attr(".uml-class-name-rect/stroke", "#0000FF"); // Cambiar borde a azul para indicar destino

        // Cuando se hayan seleccionado ambas clases, crear la relación
        if (selectedSource && selectedTarget) {
          let link;

          switch (currentRelationType) {
            case "association":
              link = new joint.shapes.standard.Link({
                source: { id: selectedSource.id },
                target: { id: selectedTarget.id },
                attrs: {
                  line: {
                    stroke: "#000000", // Color de la línea
                    strokeWidth: 2, // Ancho de la línea
                    targetMarker: {
                      type: "none", // No mostrar ninguna flecha en el destino
                    },
                  },
                },
              });
              break;
            case "dependency":
              link = new joint.shapes.standard.Link({
                source: { id: selectedSource.id },
                target: { id: selectedTarget.id },
                attrs: {
                  line: { strokeDasharray: "5 5" },
                  targetMarker: {
                    type: "path",
                    d: "M 10 -5 0 0 10 5 Z",
                    fill: "white",
                    stroke: "black",
                  },
                },
              });
              break;
            case "aggregation":
              link = new joint.shapes.standard.Link({
                source: { id: selectedSource.id },
                target: { id: selectedTarget.id },
                attrs: {
                  line: {
                    sourceMarker: {
                      type: "path",
                      d: "M 10 0 L 5 -5 L 0 0 L 5 5 Z",
                      fill: "white",
                    },
                  },
                },
              });
              break;
            case "composition":
              link = new joint.shapes.standard.Link({
                source: { id: selectedSource.id },
                target: { id: selectedTarget.id },
                attrs: {
                  line: {
                    sourceMarker: {
                      type: "path",
                      d: "M 10 0 L 5 -5 L 0 0 L 5 5 Z",
                      fill: "black",
                    },
                  },
                },
              });
              break;
            case "inheritance":
              link = new joint.shapes.standard.Link({
                source: { id: selectedSource.id },
                target: { id: selectedTarget.id },
                attrs: {
                  line: {
                    targetMarker: {
                      type: "path",
                      d: "M 10 -5 0 0 10 5 Z",
                      fill: "white",
                    },
                  },
                },
              });
              break;
          }

          graph.addCell(link);

          // Resetear las selecciones y bordes
          resetClassBorders();
          selectedSource = null;
          selectedTarget = null;
          currentRelationType = null; // Reiniciar el tipo de relación actual
          updateSelectionInfo(); // Actualizar la interfaz para mostrar las selecciones vacías
        }
      }
      updateSelectionInfo(); // Actualizar la interfaz después de cada selección
    }
  });

  // Manejar clics en los botones de relaciones
  $("#addAssociation").on("click", function () {
    addRelationship("association");
  });

  $("#addDependency").on("click", function () {
    addRelationship("dependency");
  });

  $("#addAggregation").on("click", function () {
    addRelationship("aggregation");
  });

  $("#addComposition").on("click", function () {
    addRelationship("composition");
  });

  $("#addInheritance").on("click", function () {
    addRelationship("inheritance");
  });

  // Mostrar la selección en la interfaz
  $("#selectionInfo").text(
    "Selecciona el tipo de relación y luego el origen y destino."
  );

  // **Evento para manejar cuando se hace clic en una relación para agregar cardinalidad**
  paper.on("link:pointerclick", (linkView) => {
    const link = linkView.model;

    // Pedir al usuario que ingrese la cardinalidad del origen y destino
    const sourceCardinality = prompt(
      "Ingresa la cardinalidad en el lado del origen (por ejemplo, 1, 0..*, etc.):"
    );
    const targetCardinality = prompt(
      "Ingresa la cardinalidad en el lado del destino (por ejemplo, 1, 0..*, etc.):"
    );

    if (sourceCardinality !== null && targetCardinality !== null) {
      // Agregar las etiquetas de cardinalidad al link
      link.label(0, {
        position: 0.1, // Posición cerca del origen
        attrs: {
          text: {
            text: sourceCardinality,
            "font-size": 12,
            "font-family": "Arial",
          },
        },
      });

      link.label(1, {
        position: 0.9, // Posición cerca del destino
        attrs: {
          text: {
            text: targetCardinality,
            "font-size": 12,
            "font-family": "Arial",
          },
        },
      });
    }
  });
});

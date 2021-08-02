import _ from 'lodash';

async function onCascadeCreate(items, cascade, app) {
  async function addChildToParent(cascade, items) {
    let parent = await app.services[cascade.model].findById(items[0][cascade.parentId]);
    items.forEach((item) => {
      if (parent[cascade.field].indexOf(item._id) < 0) {
        parent[cascade.field].push(item._id);
      }
    });
    await parent.save();
  }

  if (cascade.parent) {
    for (let i = 0; i < cascade.parent.length; i++) {
      if (cascade.parent[i].onCreation) {
        if (_.isArray(items)) {
          // group items to optimize creation if they has same parent
          let groupedItems = _.groupBy(items, cascade.parent[i].parentId);
          await Promise.all(Object.keys(groupedItems).map((datasetName) => addChildToParent(cascade.parent[i], groupedItems[datasetName])));
        } else {
          await addChildToParent(cascade.parent[i], [items]);
        }
      }
    }
  }
}

async function __onDeleteForParent(items, cascade, app) {
  if (!cascade.children) return;

  const deletedIds = _.map(items, item => item._id);
  await Promise.all(_.map(cascade.children, child => {
    const filter = { [child.foreignKey]: { $in: deletedIds } };
    return app.services[child.model].deleteMany(filter);
  }));
}

async function __onDeleteForChild(items, cascade, app) {
  async function deleteChildFromParent(cascade, childrens) {
    let itemsIds = _.flatten(childrens).map(item => item._id.toString());
    let parentId = childrens[0][cascade.parentId];
    
    let parent;
    try {
      parent = await app.services[cascade.model].findById(parentId);
    } catch (e) {
      console.log("MongoCascadeRelation.plugin (line : 54) | _onDeleteForChild | e : ", e);
    }
    
    if (parent) {
      if (_.isArray(parent[cascade.field])) {
        parent[cascade.field] = _.difference(parent[cascade.field], itemsIds);
      } else {
        parent[cascade.field] = itemsIds.indexOf(parent[cascade.field]) < 0 ? parent[cascade.field] : null;
      }
      
      try {
        await parent.save();
      } catch (e) {
        console.log("MongoCascadeRelation.plugin (line : 66) | _onDeleteForChild | e : ", e);
      }
    }
  }
  
  if (cascade.parent) {
    for (let i = 0; i < cascade.parent.length; i++) {
      if (cascade.parent[i].onDelete) {
        // group items to optimize creation if they has same parent
        let groupedItems = _.groupBy(items, cascade.parent[i].parentId);
        await Promise.all(Object.keys(groupedItems).map((datasetName) => deleteChildFromParent(cascade.parent[i], groupedItems[datasetName])));
      }
    }
  }
}

async function onCascadeDelete(items, cascade, app) {
  return Promise.all([
    __onDeleteForParent(items, cascade, app),
    __onDeleteForChild(items, cascade, app)
  ])
}

export default (cascade) => {
  return {
    staticMethods: {
      async findByIdAndDelete(id, options = {}) {
          if (this.beforeDelete) await this.beforeDelete(id);
          const result = await this.model.findByIdAndDelete(id);

          if (!options.withoutCascade && result) {
            try {
              await onCascadeDelete([result], cascade, this.app);
            } catch (e) {
              console.log("MongoCascadeRelation.plugin (line : 94) | findByIdAndDelete | e : ", e);
            }
          }

          if (this.afterDelete) {
            try {
              await this.afterDelete(id, result);
            } catch (e) {
              console.log("MongoCascadeRelation.plugin (line : 101) | findByIdAndDelete | e : ", e);
            }
          }

          return result;
      },

      async findOneAndDelete(filter = {}, options = {}) {
        if (this.beforeDelete) await this.beforeDelete(filter, options);
        const result = await this.model.findOneAndDelete(filter, options);

        if (!options.withoutCascade && result) await onCascadeDelete([result], cascade, this.app);

        if (this.afterDelete) await this.afterDelete(filter, result);

        return result;
      },
      async deleteMany(filter = {}, options = {}) {
        if (this.beforeDelete) await this.beforeDelete(filter, options);
        let data = await this.model.find(filter, '_id'+(cascade.children ? ' '+cascade.children.map((c) => c.field).join(" "): ''));

        const res = await this.model.deleteMany(filter, options);

        if (!options.withoutCascade && res) await onCascadeDelete(data, cascade, this.app);
        if (this.afterDelete) await this.afterDelete(filter, res);

        return res;
      },
      async deleteOne(filter = {}, options = {}) {
        if (this.beforeDelete) await this.beforeDelete(filter, options);

        let data = await this.model.findOne(filter, '_id'+(cascade.children ? ' '+cascade.children.map((c) => c.field).join(" "): ''));

        const res = await this.model.deleteOne(filter, options);

        if (!options.withoutCascade && res) await onCascadeDelete([data], cascade, this.app);
        if (this.afterDelete) await this.afterDelete(filter, res);

        return res;
      },
      async create(data, options = {}) {
        if (this.beforeCreate) data = await this.beforeCreate(data);
        
        let item;
        try {
            item = await this.model.create(data);
        } catch (e) {
            console.log("class (line : 147) | create | e : ", e);
            throw e;
        }

        if (_.isArray(item)) {
            item = item.map((oneItem) => new this(oneItem.toObject()));
        } else {
            item = new this(item.toObject());
        }

        if (!options.withoutCascade) await onCascadeCreate((_.isArray(item) ? item : [item]), cascade, this.app);
        if (this.afterCreate) await this.afterCreate(data, item);

        return item;
      }
    }
  }
}